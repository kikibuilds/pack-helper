// 发货助手的外壳：首页、页面切换（路由）、功能管理、顶栏的运行进度。
// 各功能本身的逻辑不在这里（发货 / 远程指令 / 运行监控在 batch.js），这里只负责「去哪一页、显示什么卡片」。
import { listModules, getModule, isEnabled } from './registry.js';
import '../modules/index.js';
import { getSettings, saveSettings, getOrders } from '../lib/store.js';
import { buildDiagnostics } from '../lib/diag.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 私有模块（不在公开仓库里）：有就加载，没有就跳过
let privateError = '';
try { await import('../modules-private/index.js'); } catch (e) {
  if (!/Failed to fetch|not found|Cannot find|Failed to resolve|error loading dynamically imported module/i.test(e.message)) privateError = e.message;
}

const LOCAL_KEYS = ['lastScan', 'lastRun', 'lastMail', 'remoteLastPoll', 'remoteLog', 'heartbeatLast', 'loginCheckLast', 'loginCheckLog', 'runStatus'];
async function context() {
  const [settings, orders, local] = await Promise.all([getSettings(), getOrders(), chrome.storage.local.get(LOCAL_KEYS)]);
  const diag = buildDiagnostics({ version: '', settings, orders, ...local }).status;
  return { settings, orders, local, diag };
}

// ===================== 路由 =====================
// #/home、#/<模块>、#/<模块>/<子页面>、#/settings/<子页面>
// 旧地址 #run、#run=depop、#remote（一键拉取 / 远程指令自动打开）显示在「发货 → 拉取订单」
const PAGE_NAMES = { home: '', settings: '设置' };
function parse() {
  const h = location.hash;
  if (/^#(run|remote)/.test(h)) return { view: 'shipping', sub: 'pull' };
  const m = h.match(/^#\/([a-z][a-z0-9-]*)(?:\/([a-z0-9-]+))?/);
  return m ? { view: m[1], sub: m[2] || '' } : { view: 'home', sub: '' };
}

async function route() {
  let { view, sub } = parse();
  const settings = await getSettings();
  const mod = getModule(view);
  if (mod && !isEnabled(settings, view)) view = 'home'; // 关掉的功能不能直接进
  const section = viewEl(view);
  if (!section) { view = 'home'; }
  for (const el of $$('section.view')) el.classList.toggle('on', el.dataset.view === view);
  const cur = viewEl(view);
  // 子页面：没指定就用第一个
  const panes = [...cur.querySelectorAll(':scope .pane[data-pane]')];
  if (panes.length) {
    if (!panes.some((p) => p.dataset.pane === sub)) sub = panes[0].dataset.pane;
    for (const p of panes) p.classList.toggle('on', p.dataset.pane === sub);
    for (const a of cur.querySelectorAll('[data-sub]')) a.classList.toggle('on', a.dataset.sub === sub);
  }
  const name = mod ? mod.name : PAGE_NAMES[view];
  $('#crumb').innerHTML = name ? `› <b>${esc(name)}</b>` : '';
  document.title = name ? `发货助手 · ${name}` : '发货助手';
  if (view === 'home') renderHome();
  if (view === 'settings' && sub === 'modules') renderModuleList();
  if (view === 'monitor' && sub === 'diag') renderDiagStatus();
  window.scrollTo(0, 0);
}
function viewEl(view) { return document.querySelector(`section.view[data-view="${view}"]`); }
window.addEventListener('hashchange', route);

// ===================== 自己画界面的模块 =====================
function mountModules() {
  for (const m of listModules()) {
    if (m.view || typeof m.mount !== 'function' || viewEl(m.id)) continue;
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.dataset.view = m.id;
    $('#moduleViews').append(sec);
    try { m.mount(sec); } catch (e) { sec.innerHTML = `<div class="note warn">模块「${esc(m.name)}」加载出错：${esc(e.message)}</div>`; }
  }
  // 往别的页面里加子页面（比如私有模块往「运行监控」里加「同步记录」）
  for (const m of listModules()) {
    for (const p of m.panes || []) {
      const host = viewEl(p.view);
      if (!host || host.querySelector(`.pane[data-pane="${p.id}"]`)) continue;
      const nav = host.querySelector('nav.side, nav.tabs');
      const a = document.createElement('a');
      a.dataset.sub = p.id; a.href = `#/${p.view}/${p.id}`; a.textContent = p.title;
      a.dataset.module = m.id;
      if (nav) nav.append(a);
      const pane = document.createElement('div');
      pane.className = 'pane panel'; pane.dataset.pane = p.id; pane.dataset.module = m.id;
      (host.querySelector('.layout > div:last-child') || host).append(pane);
      try { p.mount(pane); } catch (e) { pane.innerHTML = `<div class="note warn">加载出错：${esc(e.message)}</div>`; }
    }
  }
}

// ===================== 首页 =====================
const LEVEL_ORDER = { bad: 0, warn: 1, ok: 2, off: 3 };
async function renderHome() {
  const ctx = await context();
  const mods = listModules().filter((m) => isEnabled(ctx.settings, m.id));
  const todos = [];
  const cards = [];
  for (const m of mods) {
    let st = { level: 'off', text: '' };
    try { if (m.status) st = (await m.status(ctx)) || st; } catch (e) { st = { level: 'bad', text: `状态读取出错：${e.message}` }; }
    try { if (m.todos) todos.push(...((await m.todos(ctx)) || [])); } catch { /* 忽略单个模块的错误 */ }
    cards.push(`
      <a class="card${m.core ? ' main' : ''}" href="#/${esc(m.id)}">
        <div class="h"><span class="ic">${esc(m.icon || '•')}</span>${esc(m.name)}</div>
        <div class="muted">${esc(m.desc || '')}</div>
        <div class="st"><span class="dot ${esc(st.level)}"></span>${esc(st.text)}</div>
      </a>`);
  }
  cards.push(`
    <a class="card soon" href="#/settings/modules">
      <div class="h"><span class="ic">➕</span>功能管理</div>
      <div class="muted">打开或关掉功能；也可以照着 docs/MODULES.md 加自己的功能</div>
    </a>`);
  if (privateError) todos.push({ level: 'bad', title: '私有模块加载出错', detail: privateError, route: '#/settings/modules' });
  todos.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  $('#homeTodos').innerHTML = todos.length
    ? todos.map((t) => `<a class="todo ${esc(t.level)}" href="${esc(t.route || '#/home')}"><b>${esc(t.title)}</b><span>${esc(t.detail || '')}</span></a>`).join('')
    : '<div class="todo ok"><b>一切正常</b><span>没有需要处理的事</span></div>';
  $('#homeCards').innerHTML = cards.join('');
}

// ===================== 功能管理 =====================
async function renderModuleList() {
  const s = await getSettings();
  $('#moduleList').innerHTML = listModules().map((m) => `
    <div class="modrow">
      <span class="ic">${esc(m.icon || '•')}</span>
      <div><b>${esc(m.name)}</b>${m.private ? ' <span class="tag">私有</span>' : ''}<div class="muted">${esc(m.desc || '')}</div></div>
      ${m.core ? '<span class="tag">必备</span>'
        : `<label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" ${isEnabled(s, m.id) ? 'checked' : ''}><span></span></label>`}
    </div>`).join('') + (privateError ? `<div class="note warn">私有模块加载出错：${esc(privateError)}</div>` : '');
}
$('#moduleList').addEventListener('change', async (ev) => {
  const id = ev.target.dataset.mod;
  if (!id) return;
  const s = await getSettings();
  await saveSettings({ ...s, modules: { ...s.modules, [id]: ev.target.checked } });
  const m = getModule(id);
  if (m && typeof m.onToggle === 'function') { try { await m.onToggle(ev.target.checked); } catch { /* ignore */ } }
});

// ===================== 运行监控 → 诊断：状态一览 =====================
async function renderDiagStatus() {
  const { diag } = await context();
  $('#diagStatus').innerHTML = diag.filter((x) => x.name !== '插件版本')
    .map((x) => `<div class="k">${esc(x.name)}</div><div class="lv-${esc(x.level)}">${esc(x.text)}</div>`).join('');
}

// ===================== 顶栏：正在拉取的进度（在哪一页都看得到） =====================
function syncRunPill() {
  const running = !$('#runBox').hidden;
  const pill = $('#runPill');
  pill.hidden = !running;
  if (running) pill.textContent = `⏳ ${($('#runMsg').textContent || '正在运行…').slice(0, 48)}`;
}
new MutationObserver(syncRunPill).observe($('#runBox'), { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });

// 「② 批次与打包」标签上的单数
async function syncTabCount() {
  const orders = await getOrders();
  const n = new Set(orders.map((o) => `${o.platform}|${o.orderId || o.id}`)).size;
  $('#tabCount').textContent = n ? String(n) : '';
}

// 设置变化 / 运行记录变化：首页和状态跟着刷新
let refreshTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (changes.orders) syncTabCount();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const { view, sub } = parse();
    if (view === 'home' || !location.hash) renderHome();
    if (view === 'monitor' && sub === 'diag') renderDiagStatus();
    if (changes.settings && view === 'settings') renderModuleList();
  }, 300);
});

// 一个按钮代替另一个按钮（比如「邮件标题和正文」页的保存按钮 = 「邮件账号」页的保存按钮）
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-click]');
  if (b) { ev.preventDefault(); const t = $(b.dataset.click); if (t) t.click(); }
});

$('#verAbout').textContent = `V${chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version}`;
mountModules();
syncTabCount();
route();
