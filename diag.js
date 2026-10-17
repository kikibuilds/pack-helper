// 诊断页面：集中显示运行情况，一键导出（打码后的）诊断信息
import { getSettings, getOrders } from './lib/store.js';
import { callMailer } from './lib/mail.js';
import { buildDiagnostics, diagnosticsText } from './lib/diag.js';
import { initI18n, setLang, getLang } from './lib/i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const version = () => chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
let mailer = null;
let current = null;

async function collect() {
  const keys = ['lastScan', 'lastRun', 'lastMail', 'remoteLastPoll', 'remoteLog', 'heartbeatLast', 'loginCheckLast', 'loginCheckLog'];
  const st = await chrome.storage.local.get(keys);
  return { version: version(), settings: await getSettings(), orders: await getOrders(), mailer, ...st };
}

async function render() {
  current = buildDiagnostics(await collect());
  $('#status').innerHTML = current.status.map((x) => `<div class="k">${esc(x.name)}</div><div class="lv-${esc(x.level)}">${esc(x.text)}</div>`).join('');
  $('#sections').innerHTML = current.sections.map((s) => `<div class="sec"><h2>${esc(s.title)}</h2><pre>${esc(s.lines.join('\n'))}</pre></div>`).join('');
}

function note(msg) {
  const el = $('#note');
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(note.t);
  note.t = setTimeout(() => { el.hidden = true; }, 6000);
}

$('#btnRefresh').addEventListener('click', render);
$('#btnMailer').addEventListener('click', async () => {
  $('#btnMailer').disabled = true;
  mailer = await callMailer({ action: 'ping' }, 20000);
  $('#btnMailer').disabled = false;
  await render();
});
$('#btnCopy').addEventListener('click', async () => {
  await render();
  try { await navigator.clipboard.writeText(diagnosticsText(current)); note('已复制，可以直接粘贴到邮件或聊天里。'); } catch { note('复制失败，请改用「导出诊断信息」。'); }
});
$('#btnExport').addEventListener('click', async () => {
  await render();
  const text = diagnosticsText(current);
  const n = new Date(); const z = (x) => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}${z(n.getMonth() + 1)}${z(n.getDate())}_${z(n.getHours())}${z(n.getMinutes())}`; // 电脑本地时间
  const name = `发货助手诊断_${stamp}.txt`;
  // 用 Chrome 的下载接口：中文文件名不会变成「download」
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({ url, filename: name, saveAs: false, conflictAction: 'uniquify' });
  note(`已导出 ${name}（在 Chrome 的下载内容里）。`);
});
chrome.storage.onChanged.addListener(() => { render(); });

initI18n();
$('#btnLang').addEventListener('click', () => { setLang(getLang() === 'en' ? 'zh' : 'en'); });
$('#ver').textContent = `V${version()}`;
render();
