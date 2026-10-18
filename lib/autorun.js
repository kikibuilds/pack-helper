// 一键全自动：依次打开四个平台的待发货列表 → 逐单读取 → 抓面单 → 生成发货文件和报告。
// 在批次页（扩展页面）里运行，运行期间请保持批次页打开。
import {
  extractOrderFromPage, collectOrderLinks, findLabelOnPage, clickFilter, scrollToLoadAll, pageHints,
  extractListRows, clickRowLabel, findEmbeddedLabel, installBlobHook, readHookedBlob, clickModalDownload, findDescriptionsByImage,
} from './extract.js';
import {
  whatnotShipmentRows, whatnotShipmentDetail, whatnotSidebarAction,
  bracketSku, whatnotShipped, whatnotNeedsLabel, whatnotBigImage, skusFromSlip, readWhatnotSlip, splitWhatnotLabel,
} from './whatnot.js';
import {
  addOrder, getOrders, getSettings, isSent, setLabel, getLabel, assignPool, isPdfBytes, getPool, removeFromPool,
  updateOrder, pruneStale,
  AUTO_PLATFORMS, titleForSku,
} from './store.js';
import { PLATFORM_META } from './report.js';

const PLATFORMS = AUTO_PLATFORMS; // eBay 需要自己买面单，暂不在一键运行里；Whatnot 只抓已经生成好的面单

// —— 停止：点「停止」后，在下一个检查点（最多约 1 秒）结束运行 ——
let stopRequested = false;
class StopError extends Error {
  constructor() { super('已手动停止'); this.name = 'StopError'; }
}
export function requestStop() { stopRequested = true; }
const checkStop = () => { if (stopRequested) throw new StopError(); };
async function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    checkStop();
    await new Promise((r) => setTimeout(r, Math.min(300, end - Date.now())));
  }
  checkStop();
}

const openTabs = new Set(); // 本次运行打开的标签页，停止时一并关掉
function openTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      openTabs.add(tab.id);
      const timer = setTimeout(done, 30000);
      const poll = setInterval(() => { if (stopRequested) done(); }, 300);
      function listener(id, info) { if (id === tab.id && info.status === 'complete') done(); }
      function done() {
        clearTimeout(timer);
        clearInterval(poll);
        chrome.tabs.onUpdated.removeListener(listener);
        if (stopRequested) { closeTab(tab.id); reject(new StopError()); } else resolve(tab);
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
const closeTab = (id) => { openTabs.delete(id); return chrome.tabs.remove(id).catch(() => {}); };
async function run(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}
/** 在网页自己的环境里运行（用来截住网页生成的面单文件） */
async function runMain(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'MAIN' });
  return result;
}

async function fetchPdf(url) {
  const r = await fetch(url, { credentials: 'include' });
  const u8 = new Uint8Array(await r.arrayBuffer());
  return isPdfBytes(u8) ? new Blob([u8], { type: 'application/pdf' }) : null;
}

/** 面单可能是 PDF，也可能是图片（PNG/JPG/GIF）。返回 Blob 或 null。 */
async function fetchLabel(url) {
  const r = await fetch(url, { credentials: 'include' });
  const u8 = new Uint8Array(await r.arrayBuffer());
  if (isPdfBytes(u8)) return new Blob([u8], { type: 'application/pdf' });
  const type = imageType(u8);
  return type ? new Blob([u8], { type }) : null;
}
function imageType(u8) {
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
  return '';
}

/** 读取已经下载到电脑上的文件。需要在 chrome://extensions 里给扩展打开「允许访问文件网址」。 */
function readLocalFile(fullPath) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'file://' + fullPath.split('/').map(encodeURIComponent).join('/'));
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => (xhr.response ? resolve(new Uint8Array(xhr.response)) : reject(new Error('空文件')));
    xhr.onerror = () => reject(new Error('NO_FILE_ACCESS'));
    xhr.send();
  });
}
let fileAccessMissing = false;

/**
 * 点了面单按钮后，等面单出现：
 * ① 浏览器下载了 PDF：先从网址重新取，取不到再读下载好的文件
 * ② 后台截获的下载进入待分配区
 * ③ 新标签页（包括没有 opener 的）/ 本标签页打开了 PDF、面单图片，或一个嵌着 PDF 的网页
 * 返回 { ok, events }：events 记录这期间发生了什么，失败时写进报告
 */
function waitForLabel(rowId, orderTabId, ms) {
  return new Promise((resolve) => {
    const events = [];
    const note = (s) => { if (events.length < 8) events.push(s); };
    const created = new Set();
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(poll);
      clearInterval(blobPoll);
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.tabs.onUpdated.removeListener(onTab);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onDownload);
      chrome.downloads.onCreated.removeListener(onDlCreated);
      resolve({ ok, events });
    };
    const shortUrl = (u) => { try { const x = new URL(u); return x.host + x.pathname.slice(0, 60); } catch { return String(u).slice(0, 40); } };
    function onDlCreated(item) { note(`开始下载 ${shortUrl(item.finalUrl || item.url)}（${item.mime || '类型未知'}）`); }
    async function onDownload(delta) {
      if (delta.state && delta.state.current === 'interrupted') note('下载被中断');
      if (!delta.state || delta.state.current !== 'complete') return;
      const [item] = await chrome.downloads.search({ id: delta.id });
      if (!item || /发货包?_\d{4}-/.test(item.filename || '')) return; // 自己生成的发货文件，不是面单
      const src = item.finalUrl || item.url || '';
      if (/^https?:/i.test(src)) {
        try {
          const blob = await fetchLabel(src);
          if (blob) { await setLabel(rowId, blob); finish(true); return; }
        } catch { /* 改为读本地文件 */ }
      }
      try {
        const bytes = await readLocalFile(item.filename);
        const type = isPdfBytes(bytes) ? 'application/pdf' : imageType(bytes);
        if (type) {
          await setLabel(rowId, new Blob([bytes], { type }));
          finish(true);
          // 后台可能也把同一个文件放进了「待分配面单」，稍后清掉，避免重复
          const base = item.filename.split('/').pop();
          setTimeout(async () => {
            for (const p of await getPool()) if (p.filename === base) await removeFromPool(p.id);
          }, 4000);
        } else {
          note(`下载的文件不是 PDF 或图片：${item.filename.split('/').pop()}`);
        }
      } catch (e) {
        if (e.message === 'NO_FILE_ACCESS') fileAccessMissing = true; // 交给 ② 或超时
      }
    }
    function onCreated(tab) { created.add(tab.id); }
    chrome.downloads.onCreated.addListener(onDlCreated);
    chrome.downloads.onChanged.addListener(onDownload);
    chrome.tabs.onCreated.addListener(onCreated);
    const timer = setTimeout(() => finish(false), ms);
    const poll = setInterval(() => { if (stopRequested) finish(false); }, 300);
    // 网页内部生成的面单（blob）：每秒看一次钩子有没有截到
    let checking = false;
    const blobPoll = setInterval(async () => {
      if (finished || checking) return;
      checking = true;
      try {
        const b64 = await runMain(orderTabId, readHookedBlob);
        if (b64 && !finished) {
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const type = isPdfBytes(u8) ? 'application/pdf' : imageType(u8);
          if (type) { note('从网页里截到了面单文件'); await setLabel(rowId, new Blob([u8], { type })); finish(true); }
        }
      } catch { /* 页面可能已跳走 */ }
      checking = false;
    }, 1000);
    async function onStorage(changes) {
      if (!changes.labelPool) return;
      const before = new Set((changes.labelPool.oldValue || []).map((p) => p.id));
      const added = (changes.labelPool.newValue || []).find((p) => !before.has(p.id));
      if (added && await assignPool(added.id, rowId)) finish(true);
    }
    const tried = new Set();
    async function onTab(tabId, info, tab) {
      const isNew = tabId !== orderTabId && (tab.openerTabId === orderTabId || created.has(tabId));
      if (info.status !== 'complete' || (tabId !== orderTabId && !isNew)) return;
      const url = tab.url || '';
      if (!/^https?:/.test(url) || tried.has(url)) return;
      tried.add(url);
      if (isNew) note(`打开了新标签页 ${shortUrl(url)}`);
      else note(`本页跳转到 ${shortUrl(url)}`);
      let fetched = false;
      try {
        const blob = await fetchLabel(url);
        fetched = true;
        if (blob) {
          await setLabel(rowId, blob);
          if (isNew) closeTab(tabId);
          finish(true);
          return;
        }
      } catch { /* 跨站读取被拦截，改用下载 */ }
      if (fetched) {
        // 是个网页：看看里面有没有嵌着 PDF 或面单图片
        try {
          const cands = await run(tabId, findEmbeddedLabel);
          for (const c of cands || []) {
            if (/^https?:/.test(c.url)) {
              try {
                const blob = await fetchLabel(c.url);
                if (blob) { await setLabel(rowId, blob); if (isNew) closeTab(tabId); finish(true); return; }
              } catch { /* 下一个 */ }
            }
          }
          if (cands && cands.length) note(`网页里找到 ${cands.length} 个可能的面单地址，但都取不到`);
        } catch (e) { note(`读取新页面失败：${e.message}`); }
      } else if (isNew) {
        // 面单在别的网站上（读取被拦截）：交给浏览器下载，onDownload 会读取下载好的文件
        chrome.downloads.download({ url, filename: `面单原件/label_${Date.now()}`, conflictAction: 'uniquify', saveAs: false })
          .then(() => closeTab(tabId)).catch(() => {});
      }
    }
    chrome.storage.onChanged.addListener(onStorage);
    chrome.tabs.onUpdated.addListener(onTab);
  });
}

const whyFailed = (text, w) => {
  if (fileAccessMissing) return `点了「${text}」，文件已下载到电脑，但扩展没有读取权限：请在 chrome://extensions → 发货助手 → 详情，打开「允许访问文件网址」`;
  return `点了「${text}」但 30 秒内没拿到面单（这期间：${w.events.length ? w.events.join('；') : '没有新标签页，也没有下载'}）`;
};

// finder：在页面里找面单按钮的函数和参数（默认是通用的 findLabelOnPage；Whatnot 只在右边详情栏里找）
const GENERIC_FINDER = { func: findLabelOnPage, args: (mode) => [mode] };
async function grabLabel(tabId, order, finder = GENERIC_FINDER) {
  const found = await run(tabId, finder.func, finder.args('find'));
  if (!found || !found.found) {
    return (order.platform === 'ebay'
      ? '页面上没有「打印面单」按钮（这单可能还没买面单，扩展不会替你购买）'
      : order.platform === 'whatnot'
        ? 'Whatnot 详情栏里没找到「Print Label / Download Label」按钮'
        : '页面上没找到「打印/下载面单」按钮') + await hintFor(tabId, `label:${order.platform}`);
  }
  if (found.href) {
    try {
      const blob = await fetchLabel(found.href);
      if (blob) { await setLabel(order.id, blob); return ''; }
    } catch { /* 改为点击 */ }
  }
  await runMain(tabId, installBlobHook).catch(() => {});
  const waiting = waitForLabel(order.id, tabId, 30000);
  await run(tabId, finder.func, finder.args('click'));
  // 点了之后可能弹出确认框（Poshmark），里面还要再点一次 Download
  let modal = null;
  for (let k = 0; k < 8 && !modal; k++) {
    await sleep(700);
    const r = await run(tabId, clickModalDownload).catch(() => null);
    if (r && r.clicked) modal = r;
  }
  const w = await waiting;
  if (modal) w.events.unshift(`在弹窗里又点了「${modal.text}」`);
  if (w.ok) return '';
  checkStop();
  return whyFailed(found.text, w) + await hintFor(tabId, `labelclick:${order.platform}`);
}

/** 把页面上看到的按钮、标题整理成一两行，写进报告；每个平台每类问题只附一次，避免报告太长。 */
const hinted = new Set();
async function hintFor(tabId, key) {
  if (hinted.has(key)) return '';
  hinted.add(key);
  try {
    const h = await run(tabId, pageHints);
    const pad = '\n        ';
    const parts = [
      `页面：${h.path}（网页标题「${h.docTitle}」，商品链接 ${h.listingLinks} 个，iframe ${h.iframes} 个）`,
      h.headings.length && `标题：${h.headings.join(' / ')}`,
      h.buttons.length && `主体按钮：${h.buttons.join(' | ')}`,
      h.links.length && `主体链接：${h.links.join(' | ')}`,
      h.images.length && `最大的图片：${h.images.join(' | ')}`,
      h.texts.length && `主体文字：${h.texts.join(' | ')}`,
    ].filter(Boolean);
    return `\n      【诊断】${pad}${parts.join(pad)}`;
  } catch (e) {
    return `\n      【诊断】读取页面信息失败：${e.message}`;
  }
}

/**
 * 后台标签页有时不完整渲染页面。先在后台试几次，不行再把标签页切到前台试。
 * @param {(tabId:number)=>Promise<any>} attempt 返回真值表示成功
 */
async function retryWithFocus(tabId, attempt, { tries = 4, delay = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await attempt(tabId);
    if (r) return r;
    await sleep(delay);
  }
  try { await chrome.tabs.update(tabId, { active: true }); } catch { return null; }
  await sleep(1500);
  for (let i = 0; i < tries; i++) {
    const r = await attempt(tabId);
    if (r) return r;
    await sleep(delay);
  }
  return null;
}

/** 读取订单页；读到商品名或识别出「已发货」就算读到。 */
async function extractWithRetry(tabId) {
  let last = null;
  const ok = await retryWithFocus(tabId, async (id) => {
    last = await run(id, extractOrderFromPage);
    return last && (last.title || last.shippedStatus) ? last : null;
  });
  const res = ok || last;
  if (res && res.platform === 'mercari' && !res.shippedStatus) {
    await enrichFromItemPage(res);
    if (/^b\d{6,}$/i.test(res.orderId || '')) await mercariBundle(res);
  }
  return res;
}

/**
 * Mercari 捆绑单（订单号 b 开头）：订单页「Order summary」只显示一件，
 * 完整清单在捆绑商品页（/us/item/b…/）源代码的 JSON-LD 里：description 每行一件「m123… - "完整标题"」。
 * 页面下方「相似商品」不在 JSON-LD 里，不会读错。纯函数，方便测试。返回 [{ itemId, title }]
 */
export function parseBundleJsonLd(html, bundleId) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const node of [].concat(j, (j && j['@graph']) || [])) {
      if (!node || node['@type'] !== 'Product' || typeof node.description !== 'string') continue;
      if (bundleId && node.productID !== bundleId && node.sku !== bundleId) continue;
      for (const line of node.description.split(/\r?\n/)) {
        const x = line.trim().match(/^(m\d{6,})\s*-\s*"(.*)"$/);
        if (x && !out.some((o) => o.itemId === x[1])) out.push({ itemId: x[1], title: x[2].trim() });
      }
    }
  }
  return out;
}

/** 把捆绑单拆成每件一行（res.items）：商品名、SKU（方括号里的编号）、图片。读不到就保持原样，批次页会提示核对。 */
export async function mercariBundle(res) {
  res.isBundle = true;
  let list = [];
  try {
    const r = await fetch(`https://www.mercari.com/us/item/${res.orderId}/`, { credentials: 'include' });
    if (r.ok) list = parseBundleJsonLd(await r.text(), res.orderId);
  } catch { /* 读不到就算了 */ }
  if (list.length < 2) return;
  const items = [];
  for (const it of list) {
    const one = { orderId: it.itemId, title: it.title, itemUrl: `https://www.mercari.com/us/item/${it.itemId}/`, imageUrl: '', sku: '' };
    await enrichFromItemPage(one); // 补图片；标题已经是完整的
    items.push({ title: it.title || one.title, sku: one.sku, imageUrl: one.imageUrl, itemUrl: one.itemUrl, qty: 1 });
    await sleep(300);
  }
  res.items = items;
}

/** Mercari：再读一下商品页的 og:title / og:image（只读，不打开标签页），补上订单页没有或被截断的商品名、图片 */
async function enrichFromItemPage(res) {
  const id = ((res.itemUrl || '').match(/\/item\/(m?\d{6,})/i) || [])[1] || res.orderId;
  if (!id) return;
  try {
    const r = await fetch(res.itemUrl || `https://www.mercari.com/us/item/${id}/`, { credentials: 'include' });
    if (!r.ok) return;
    const html = await r.text();
    const meta = (p) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i'));
      return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").trim() : '';
    };
    const t = meta('og:title').replace(/\s*[|-]\s*Mercari\s*$/i, '').replace(/^Mercari\s*[|:-]\s*/i, '').trim();
    const img = meta('og:image');
    const cut = (res.title || '').replace(/\s*(…|\.\.\.)\s*$/, '');
    if (t.length >= 6 && (!res.title || cut !== res.title || (t.length > res.title.length && t.toLowerCase().startsWith(cut.toLowerCase())))) res.title = t;
    if (!res.imageUrl && /^https?:/.test(img)) res.imageUrl = img;
    if (!res.sku) { const b = [...(res.title || '').matchAll(/\[([A-Za-z0-9][\w.\-\/]{1,40})\]/g)].pop(); if (b) res.sku = b[1]; }
  } catch { /* 读不到就算了 */ }
  if (!res.imageUrl) res.imageUrl = `https://u-mercari-images.mercdn.net/photos/${id}_1.jpg`; // Mercari 商品主图的常见地址
}

/** Depop 新旧两种地址都试一下（sellinghub / selling-hub） */
function altListUrls(p, url) {
  const urls = [url];
  if (p === 'depop') {
    if (/\/sellinghub\//.test(url)) urls.push(url.replace('/sellinghub/', '/selling-hub/'));
    else if (/\/selling-hub\//.test(url)) urls.push(url.replace('/selling-hub/', '/sellinghub/'));
  }
  return urls;
}

/**
 * @param {(msg: string) => void} onProgress
 */
// Depop：订单列表的每一行就有 SKU、图片和「Download shipping label」，直接在列表上处理
const LIST_MODE = new Set(['depop']);

/** 列表模式：每单之前确认列表还在（点下载后页面可能跳走了），不在就重新打开并点筛选。 */
async function ensureList(tabId, listUrl, filter, pattern) {
  const ok = async () => {
    const r = await run(tabId, extractListRows, [pattern]).catch(() => null);
    return r && r.length ? r : null;
  };
  if (await ok()) return true;
  await chrome.tabs.update(tabId, { url: listUrl });
  await new Promise((resolve) => {
    const t = setTimeout(done, 30000);
    function l(id, info) { if (id === tabId && info.status === 'complete') done(); }
    function done() { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); }
    chrome.tabs.onUpdated.addListener(l);
  });
  await sleep(2500);
  if (filter) {
    const res = await retryWithFocus(tabId, async (id) => {
      const r = await run(id, clickFilter, [filter]);
      return r && r.clicked ? r : null;
    }, { tries: 5 });
    if (!res) return false;
    await sleep(2500);
  }
  await run(tabId, scrollToLoadAll, [pattern]);
  return !!(await ok());
}

async function runListMode(p, pname, tabId, settings, stat, extra, progress, sampled, listUrl, filter, runId) {
  const rows = (await run(tabId, extractListRows, [settings.patterns[p]])) || [];
  stat.found = rows.length;
  if (!rows.length) {
    extra.failures.push(`${pname}：「To ship」列表里没读到订单${await hintFor(tabId, `list:${p}`)}`);
    return;
  }
  // Depop 没有商品标题：按商品图片编号，从页面收到的数据里找商品描述，取第一行当商品名
  const imgId = (u) => { const m = String(u || '').match(/\/(\d{6,})_[0-9a-f]/i); return m ? m[1] : ''; };
  let descs = {};
  try {
    const ids = rows.flatMap((r) => r.items.map((it) => imgId(it.imageUrl)));
    const res = await runMain(tabId, findDescriptionsByImage, [ids]);
    descs = (res && res.found) || {};
    const hit = Object.keys(descs).length;
    if (!hit) extra.warnings.push(`${pname}：没从页面数据里找到商品描述（数据源 ${res ? res.sources : 0} 个，图片编号 ${ids.filter(Boolean).length} 个），商品名先显示 SKU，请看图`);
  } catch (e) {
    extra.warnings.push(`${pname}：读取商品描述失败（${e.message}），商品名先显示 SKU`);
  }
  const firstLine = (t) => {
    const line = String(t || '').split(/\r?\n/).map((x) => x.replace(/#\S+/g, '').trim()).find((x) => x.length >= 3) || '';
    return line.length > 90 ? `${line.slice(0, 88).replace(/\s+\S*$/, '')}…` : line;
  };
  for (const [i, row] of rows.entries()) {
    checkStop();
    await progress(`${pname}：处理第 ${i + 1}/${rows.length} 单`);
    try {
      if (row.shipped) { stat.shipped++; continue; }
      const prev = await isSent({ platform: p, orderId: row.orderId });
      if (prev) stat.skipped++;
      let first = null;
      for (const [k, it] of row.items.entries()) {
        // Depop 商品没有标题：用其他平台记住的同 SKU 商品名，没有就提示看图
        const fromDesc = firstLine(descs[imgId(it.imageUrl)]);
        const known = fromDesc || (it.sku ? await titleForSku(it.sku) : '');
        const r = await addOrder({
          platform: p, url: row.url, orderId: row.orderId, itemIndex: k,
          title: known || `Depop 商品${it.sku ? `（SKU ${it.sku}）` : ''}，请看图`,
          autoTitle: !known || !!fromDesc, sku: it.sku, qty: it.qty, imageUrl: it.imageUrl,
          source: 'auto', runId, prevPacked: prev, include: !prev,
        });
        if (!first) first = r.order;
        if (r.isNew) stat.added++;
      }
      if (!sampled.has(p)) {
        sampled.add(p);
        extra.samples.push(`${pname} ${row.orderId}：${row.items.length} 件 → ${row.items.map((x) => `${x.sku || '无 SKU'}「${firstLine(descs[imgId(x.imageUrl)]) || '没找到描述'}」`).join('、')}，${row.hasLabelButton ? '有' : '没有'}下载面单按钮`);
      }
      if (first.hasLabel) continue; // 之前打包过、但这一行还没有面单（比如清空过批次）的，也要抓，方便重新打包
      const fail = async (why) => {
        extra.labelFailures.push(`${pname} ${row.orderId}：${why}`);
        await updateOrder(first.id, { labelError: why });
      };
      if (!row.hasLabelButton) { await fail('这一行没有「Download shipping label」按钮'); continue; }
      await progress(`${pname}：下载第 ${i + 1}/${rows.length} 单的面单`);
      if (!(await ensureList(tabId, listUrl, filter, settings.patterns[p]))) { await fail('列表页丢失后重新打开失败'); continue; }
      await runMain(tabId, installBlobHook).catch(() => {});
      const waiting = waitForLabel(first.id, tabId, 30000);
      const c = await run(tabId, clickRowLabel, [row.orderId, settings.patterns[p]]);
      if (!c || !c.clicked) {
        await fail((c && c.why) || '点不到下载按钮');
        await waiting; // 等它超时收尾（不会有结果）
        continue;
      }
      for (let k = 0; k < 4; k++) {
        await sleep(700);
        const r = await run(tabId, clickModalDownload).catch(() => null);
        if (r && r.clicked) break;
      }
      const w = await waiting;
      checkStop();
      if (!w.ok) await fail(whyFailed(c.text, w));
      await sleep(1000); // 下一单之前稍等，避免两个下载混在一起
    } catch (e) {
      if (e instanceof StopError) throw e;
      stat.failed++;
      extra.failures.push(`${pname} ${row.orderId}：${e.message}`);
    }
  }
}

// ===================== Whatnot =====================
// 列表页「Shipments」每一行是一个包裹（同一买家的多件会自动合进同一个包裹）。逐个打开包裹，
// 在右边详情栏里读每件商品；SKU 先看标题里的方括号，没有就读 packing slip 里的「Fields」。
// 面单：已经生成好的才下载；还是「Needs Label」的标成缺面单，扩展不会替你点「Generate Label」。

const WHATNOT_FINDER = { func: whatnotSidebarAction, args: (mode) => [mode, 'label'] };

/** 返回 true = 列表读到了（拉取结束后会清掉这个平台这次没再出现的行） */
async function runWhatnot(p, pname, listTabId, settings, stat, extra, progress, sampled, runId) {
  // 列表是网页加载完以后才画出来的，多等几次
  const rows = await retryWithFocus(listTabId, async (id) => {
    const r = await run(id, whatnotShipmentRows).catch(() => null);
    if (r && r.length) return r;
    const empty = await run(id, () => /no shipments|nothing to ship|no results/i.test(document.body.innerText || '')).catch(() => false);
    return empty ? [] : null;
  }, { tries: 5 });
  if (!rows) {
    extra.failures.push(`${pname}：Shipments 列表里没读到包裹${await hintFor(listTabId, `list:${p}`)}`);
    return false;
  }
  const todo = rows.filter((r) => !whatnotShipped(r.status));
  stat.found = todo.length;
  stat.shipped += rows.length - todo.length;
  let slipWarned = false;
  for (const [i, row] of todo.entries()) {
    checkStop();
    await progress(`${pname}：读取包裹 ${i + 1}/${todo.length}`);
    let tabId;
    try {
      tabId = (await openTab(row.url)).id;
      await sleep(2500);
      let last = null;
      const d = await retryWithFocus(tabId, async (id) => {
        last = await run(id, whatnotShipmentDetail, [row.shipmentNo]).catch(() => null);
        return last && last.found && last.items.length ? last : null;
      });
      if (!d) throw new Error(`包裹 #${row.shipmentNo}：${(last && last.why) || '详情栏里没读到商品'}${await hintFor(tabId, `title:${p}`)}`);
      const status = d.status || row.status;
      if (whatnotShipped(status)) { stat.shipped++; stat.found--; continue; }
      if (d.items.length !== row.items && row.items) {
        extra.warnings.push(`${pname} 包裹 #${row.shipmentNo}：列表上写 ${row.items} 件，详情栏读到 ${d.items.length} 件，请打开核对`);
      }
      // 已经生成面单的包裹：「Print Shipping Label」下载的 PDF 前面就是 packing slip，最后一页是面单。
      // 先下载它：SKU 从里面的 slip 页读（不用再点「Generate Packing Slip」），打印文件只放面单页。
      let labelBlob = null;
      let labelSlipText = '';
      if (!whatnotNeedsLabel(status)) {
        const lf = await run(tabId, whatnotSidebarAction, ['find', 'label']).catch(() => null);
        if (lf && lf.found && lf.href) {
          try {
            const r = await fetch(lf.href, { credentials: 'include' });
            const u8 = new Uint8Array(await r.arrayBuffer());
            if (isPdfBytes(u8)) {
              const sp = await splitWhatnotLabel(u8);
              labelBlob = new Blob([sp.labelBytes], { type: 'application/pdf' });
              labelSlipText = sp.slipText;
            }
          } catch { /* 读不到就照旧点按钮下载 */ }
        }
      }
      // SKU：① 标题里的方括号 ② 面单 PDF 里自带的 packing slip ③ 点「Generate Packing Slip」读 ④ 之前在批次页填过的（addOrder 自动带出）
      const skus = d.items.map((it) => bracketSku(it.title));
      if (labelSlipText && skus.some((x) => !x)) {
        const fromLabel = skusFromSlip(labelSlipText, d.items.map((it) => it.title), d.items.map((it) => it.orderNo));
        skus.forEach((x, k) => { if (!x && fromLabel[k]) skus[k] = fromLabel[k]; });
      }
      const needsLabel = whatnotNeedsLabel(status);
      if (skus.some((x) => !x)) {
        await progress(`${pname}：读取包裹 ${i + 1}/${todo.length} 的 packing slip`);
        const slip = await readWhatnotSlip(tabId);
        const fromSlip = slip.text ? skusFromSlip(slip.text, d.items.map((it) => it.title), d.items.map((it) => it.orderNo)) : [];
        skus.forEach((x, k) => { if (!x && fromSlip[k]) skus[k] = fromSlip[k]; });
        const still = d.items.filter((_, k) => !skus[k]).length;
        if (still && (!slipWarned || !slip.text)) {
          slipWarned = true;
          // 不把 slip 的内容写进报告：里面有收件人姓名和地址
          extra.warnings.push(`${pname} 包裹 #${row.shipmentNo}：${still} 件标题里没有 [SKU]，packing slip 里也没读到 SKU`
            + `（${slip.text ? `读到了 slip（${slip.how}，${slip.text.split('\n').length} 行），但没有对应订单号的「SKU」行` : slip.why}），请在批次页补 SKU`);
        }
      }
      const prev = await isSent({ platform: p, orderId: row.shipmentNo });
      if (prev) stat.skipped++;
      let first = null;
      for (const [k, it] of d.items.entries()) {
        const r = await addOrder({
          platform: p, url: row.url, orderId: row.shipmentNo, itemIndex: k,
          title: it.title || `（第 ${k + 1} 件，未读到商品名）`, sku: skus[k], qty: 1, itemOrderNo: it.orderNo,
          imageUrl: whatnotBigImage(it.imageUrl), trackingLast4: (row.tracking || '').slice(-4),
          source: 'auto', runId, prevPacked: prev, include: !prev,
        });
        if (!first) first = r.order;
        if (r.isNew) stat.added++;
      }
      if (!sampled.has(p)) {
        sampled.add(p);
        extra.samples.push(`${pname} 包裹 #${row.shipmentNo}（${status}）：${d.items.length} 件 → ${d.items.map((x, k) => `「${x.title}」${skus[k] ? `[${skus[k]}]` : '（无 SKU）'} 订单 #${x.orderNo}`).join('、')}`);
      }
      if (first.hasLabel) continue;
      if (needsLabel) {
        const why = 'Whatnot 还没生成面单（Needs Label）：请在 Whatnot 的 Shipments 里打开这个包裹，确认重量、尺寸后点「Generate Label」，再拉取一次。扩展不会替你生成面单。'
          + '（打包时会放进「打印-packing slip（缺面单）.pdf」，可以先拣货）';
        extra.labelFailures.push(`${pname} #${row.shipmentNo}：还没生成面单（Needs Label）`);
        await updateOrder(first.id, { labelError: why });
        continue;
      }
      if (labelBlob) { await setLabel(first.id, labelBlob); continue; }
      await progress(`${pname}：抓取包裹 ${i + 1}/${todo.length} 的面单`);
      const why = await grabLabel(tabId, first, WHATNOT_FINDER);
      if (why) {
        extra.labelFailures.push(`${pname} #${row.shipmentNo}：${why}`);
        await updateOrder(first.id, { labelError: why.split('\n')[0] });
      } else {
        // 点按钮下载到的面单也拆一下：去掉前面的 packing slip 页，只留面单
        try {
          const b = await getLabel(first.id);
          const u8 = b ? new Uint8Array(await b.arrayBuffer()) : null;
          if (u8 && isPdfBytes(u8)) {
            const sp = await splitWhatnotLabel(u8);
            if (sp.slipPages && sp.labelPages) await setLabel(first.id, new Blob([sp.labelBytes], { type: 'application/pdf' }));
          }
        } catch { /* 拆不了就保留原文件 */ }
      }
    } catch (e) {
      if (e instanceof StopError) throw e;
      stat.failed++;
      extra.failures.push(`${pname}：${e.message}（${row.url}）`);
    } finally {
      if (tabId) closeTab(tabId);
    }
  }
  return true;
}

export async function runAll(onProgress = () => {}, { force = false, platforms = null } = {}) {
  const { runStatus } = await chrome.storage.local.get('runStatus');
  if (!force && runStatus && runStatus.running && Date.now() - runStatus.at < 10 * 60 * 1000) {
    const err = new Error('已经有一次运行在进行中');
    err.code = 'BUSY';
    throw err;
  }
  const startedAt = new Date();
  const settings = await getSettings();
  fileAccessMissing = false;
  stopRequested = false;
  hinted.clear();
  const extra = { platforms: {}, loginIssues: [], failures: [], labelFailures: [], warnings: [], samples: [] };
  const sampled = new Set();
  const runId = Date.now();
  const listedOk = []; // 列表成功读取的平台：这些平台上次拉下来、这次没再出现的行会被清掉
  const progress = async (msg) => {
    onProgress(msg);
    await chrome.storage.local.set({ runStatus: { running: true, msg, at: Date.now() } });
  };

  // 只拉选中的平台（下拉菜单）；不选就是所有平台
  const chosen = PLATFORMS.filter((p) => !platforms || platforms.includes(p));
  const byPlatform = {}; // 每个平台这次的情况（报告按平台合并，分开拉取也不会互相覆盖）
  const snap = () => ({ f: extra.failures.length, l: extra.labelFailures.length, w: extra.warnings.length, s: extra.samples.length });
  try {
    for (const p of chosen) {
      checkStop();
      const before = snap();
      try {
      const listUrl = settings.listUrls[p];
      if (!listUrl) continue;
      const pname = PLATFORM_META[p].name;
      const stat = { found: 0, added: 0, shipped: 0, skipped: 0, failed: 0 };
      extra.platforms[p] = stat;

      await progress(`${pname}：打开待发货列表…`);
      let links = [];
      const filter = (settings.listFilters[p] || '').trim();
      const urls = altListUrls(p, listUrl);
      let listOk = false;
      for (const [ui, url] of urls.entries()) {
        let tab;
        try {
          tab = await openTab(url);
          await sleep(3500);
          const current = await chrome.tabs.get(tab.id);
          const u = new URL(current.url);
          if (/log-?in|sign-?in|signin|auth/i.test(u.hostname + u.pathname)) {
            extra.loginIssues.push(p);
            listOk = true; // 已记录为登录问题，不再试其他地址
            break;
          }
          if (filter) {
            // 先点筛选（如 Depop 的「To ship」）；页面可能还在加载，或在后台没渲染完
            const res = await retryWithFocus(tab.id, async (id) => {
              const r = await run(id, clickFilter, [filter]);
              return r && r.clicked ? r : null;
            }, { tries: 5 });
            if (!res) {
              if (ui < urls.length - 1) continue; // 换另一个地址再试
              extra.failures.push(`${pname}：列表页上没找到「${filter}」按钮，为避免把已发货的订单也打包进去，本次跳过 ${pname}`
                + `（试过的地址：${urls.join('、')}）` + await hintFor(tab.id, `filter:${p}`));
              break;
            }
            await progress(`${pname}：已切换到「${filter}」，读取订单列表…`);
            await sleep(3000);
          }
          if (p === 'whatnot') {
            // Whatnot：列表每行一个包裹，逐个打开详情栏读取
            await progress(`${pname}：读取 Shipments 列表…`);
            if (await runWhatnot(p, pname, tab.id, settings, stat, extra, progress, sampled, runId)) listedOk.push(p);
            listOk = true;
            break;
          }
          await run(tab.id, scrollToLoadAll, [settings.patterns[p]]);
          if (LIST_MODE.has(p)) {
            // 列表模式：订单信息和面单按钮都在列表的每一行上，不进详情页
            await runListMode(p, pname, tab.id, settings, stat, extra, progress, sampled, url, filter, runId);
            listOk = true;
            listedOk.push(p);
            links = [];
            break;
          }
          links = (await run(tab.id, collectOrderLinks, [settings.patterns[p]])) || [];
          listOk = true;
          if (!extra.loginIssues.includes(p)) listedOk.push(p);
          break;
        } catch (e) {
          if (e instanceof StopError) throw e;
          if (ui === urls.length - 1) extra.failures.push(`${pname} 列表页：${e.message}`);
        } finally {
          if (tab) closeTab(tab.id);
        }
      }
      if (!listOk || LIST_MODE.has(p) || p === 'whatnot') continue;
      stat.found = links.length;

      let titleFailsInARow = 0;
      for (const [i, url] of links.entries()) {
        checkStop();
        // 连续 3 单都读不到商品名，说明这个平台的读取规则不对，剩下的不再浪费时间
        if (titleFailsInARow >= 3 && stat.added === 0) {
          extra.failures.push(`${pname}：连续 ${titleFailsInARow} 单读不到商品名，跳过剩余 ${links.length - i} 单（读取规则需要调整，见上面的诊断）`);
          stat.failed += links.length - i;
          break;
        }
        await progress(`${pname}：读取订单 ${i + 1}/${links.length}`);
        let tabId;
        try {
          tabId = (await openTab(url)).id;
          await sleep(2000);
          const d = await extractWithRetry(tabId);
          if (d && d.shippedStatus) { stat.shipped++; titleFailsInARow = 0; continue; } // 已寄出，不打包
          if (!d || !d.title) {
            titleFailsInARow++;
            throw new Error(`没读到商品名${await hintFor(tabId, `title:${p}`)}`);
          }
          titleFailsInARow = 0;
          if (!d.platform || d.platform === 'other') d.platform = p;
          const prev = await isSent(d);
          if (prev) stat.skipped++;
          // 多件订单（bundle）：每件一行，共用订单号和同一张面单（面单挂在第一件上）
          const base = { ...d, source: 'auto', runId, prevPacked: prev, include: !prev };
          const parts = d.items && d.items.length >= 2
            ? d.items.map((it, k) => ({ ...base, ...it, title: it.title || `（第 ${k + 1} 件，未读到商品名）`, itemIndex: k, trackingLast4: d.trackingLast4 }))
            : [base];
          let order = null;
          for (const part of parts) {
            const r = await addOrder(part);
            if (!order) order = r.order;
            if (r.isNew) stat.added++;
          }
          if (parts.length === 1 && d.isBundle) {
            extra.warnings.push(`${pname} ${order.orderId}：这一单像是 bundle（多件），但只读到 1 件，请打开订单核对，缺的商品在批次页点「+件」补上`);
          }
          if (!sampled.has(p)) {
            sampled.add(p);
            extra.samples.push(`${pname} ${order.orderId}：读到 ${parts.length} 件 → ${parts.map((x) => `「${x.title}」${x.sku ? `[${x.sku}]` : ''}`).join('、')}`
              + await hintFor(tabId, `sample:${p}`));
          }
          if (!order.hasLabel) { // 之前打包过的也抓：这一行可能是清空批次后重新建的，没有面单
            await progress(`${pname}：抓取订单 ${i + 1}/${links.length} 的面单`);
            const why = await grabLabel(tabId, order);
            if (why) {
              extra.labelFailures.push(`${pname} ${order.orderId || ''} ${order.title.slice(0, 30)}：${why}`);
              await updateOrder(order.id, { labelError: why.split('\n')[0] });
            }
          }
        } catch (e) {
          if (e instanceof StopError) throw e;
          stat.failed++;
          extra.failures.push(`${pname}：${e.message}（${url}）`);
        } finally {
          if (tabId) closeTab(tabId);
        }
      }
      } finally {
        if (extra.platforms[p]) {
          byPlatform[p] = {
            at: Date.now(),
            stat: extra.platforms[p],
            loginIssue: extra.loginIssues.includes(p),
            failures: extra.failures.slice(before.f),
            labelFailures: extra.labelFailures.slice(before.l),
            warnings: extra.warnings.slice(before.w),
            samples: extra.samples.slice(before.s),
          };
        }
      }
    }

    checkStop();
    const removed = await pruneStale(listedOk, runId);
    // 不自动打包：把这次拉取的情况存起来（和之前拉取的其他平台合并），检查后点「打包下载」才生成发货文件
    const { lastScan: old } = await chrome.storage.local.get('lastScan');
    const merged = { ...((old && old.byPlatform) || {}), ...byPlatform };
    const combined = { platforms: {}, loginIssues: [], failures: [], labelFailures: [], warnings: [], samples: [] };
    for (const [p, b] of Object.entries(merged)) {
      combined.platforms[p] = b.stat;
      if (b.loginIssue) combined.loginIssues.push(p);
      combined.failures.push(...b.failures);
      combined.labelFailures.push(...b.labelFailures);
      combined.warnings.push(...b.warnings);
      combined.samples.push(...b.samples);
    }
    if (removed) combined.warnings.push(`上次拉下来的 ${removed} 行这次在平台上没再出现（多半已经发货或取消），已从批次里去掉`);
    const lastScan = {
      at: Date.now(),
      startedAt: Math.min(startedAt.getTime(), ...Object.values(merged).map((b) => b.at || Infinity)),
      byPlatform: merged,
      extra: combined,
      lastPlatforms: chosen,
    };
    await chrome.storage.local.set({ lastScan });
    const orders = await getOrders();
    const inc = orders.filter((o) => o.include !== false);
    const pk = new Set(inc.map((o) => `${o.platform}|${o.orderId || o.id}`)).size;
    const missing = new Set(inc.filter((o) => !o.hasLabel).map((o) => `${o.platform}|${o.orderId || o.id}`));
    // 多件订单面单挂在第一件上：同一订单只要有一行有面单就算有
    for (const o of inc) if (o.hasLabel) missing.delete(`${o.platform}|${o.orderId || o.id}`);
    return { scanned: true, packages: pk, missing: missing.size, problems: extra.failures.length + extra.loginIssues.length };
  } catch (e) {
    if (e instanceof StopError) return { stopped: true, status: 'STOPPED', summary: '已手动停止' };
    throw e;
  } finally {
    for (const id of [...openTabs]) closeTab(id);
    stopRequested = false;
    // 运行中可能把其他标签页切到了前台，结束后回到批次页
    try { const me = await chrome.tabs.getCurrent(); if (me) await chrome.tabs.update(me.id, { active: true }); } catch { /* ignore */ }
    await chrome.storage.local.set({ runStatus: { running: false, msg: '', at: Date.now() } });
  }
}
