// Whatnot：Seller Hub「Shipments」页面的读取规则 + 纯函数（packing slip 里的 SKU、PDF 文字）。
//
// Whatnot 的特点：每件商品是一个单独的订单（Order #…），同一个买家的多件会自动合进同一个
// 包裹（Shipment #…），最后整个包裹生成一张面单。所以发货助手里：
//   订单号 = 包裹号（Shipment #），包裹里每件商品一行，共用一张面单。
// SKU：商品标题里的方括号（… [JC-159-10IN]）；没有方括号就读 packing slip 里 Attributes 的「Fields」。
//
// 前面几个 whatnot* 函数会被注入到 Whatnot 页面里运行（chrome.scripting.executeScript），必须自包含。
// readWhatnotSlip 在扩展页面（一键拉取）和后台（售出同步）里都会用到。
import { installBlobHook, readHookedBlob } from './extract.js';
import { isPdfBytes, getPool, removeFromPool } from './store.js';

/**
 * Shipments 列表：每一行是一个包裹。返回 [{ key, shipmentNo, status, items, tracking, actions, url }]
 * key 是网址里的那串编号（base64 的「ShipmentNode:511717219」），shipmentNo 是 511717219。
 */
export function whatnotShipmentRows() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const noOf = (key) => { try { return (atob(decodeURIComponent(key)).match(/(\d{5,})/) || [])[1] || ''; } catch { return ''; } };
  const keyFromHref = (href) => ((href || '').match(/\/dashboard\/shipments\/([A-Za-z0-9+/=%_-]{8,})/) || [])[1] || '';
  let trs = [...document.querySelectorAll('tr[data-testid^="shipments-"][data-testid$="-row"]')];
  // 备用：没有 data-testid 时，按行里「编辑」链接上的包裹编号认
  if (!trs.length) trs = [...document.querySelectorAll('tbody tr')].filter((tr) => [...tr.querySelectorAll('a[href]')].some((a) => keyFromHref(a.getAttribute('href'))));
  const table = trs[0] && trs[0].closest('table');
  const heads = table ? [...table.querySelectorAll('thead th')].map((th) => clean(th.innerText).toLowerCase()) : [];
  const col = (name) => heads.findIndex((h) => h === name);
  const ci = { items: col('items'), status: col('status'), tracking: col('tracking'), actions: col('actions') };
  const cell = (tr, i) => (i >= 0 && tr.children[i] ? tr.children[i] : null);
  const out = [];
  for (const tr of trs) {
    const tid = tr.getAttribute('data-testid') || '';
    let key = tid.replace(/^shipments-/, '').replace(/-row$/, '');
    if (!key || key === tid) key = [...tr.querySelectorAll('a[href]')].map((a) => keyFromHref(a.getAttribute('href'))).find(Boolean) || '';
    if (!key) continue;
    const st = cell(tr, ci.status);
    // 状态格：第一段是状态（Needs Label / Delivered …），后面是说明（Expected to ship via …）
    const status = st ? clean((st.querySelector('span') || st).innerText) : '';
    const tk = cell(tr, ci.tracking);
    const trackLink = tk && [...tk.querySelectorAll('a[href]')].find((a) => /track|usps|ups|fedex/i.test(a.getAttribute('href') || ''));
    const tracking = trackLink ? (((trackLink.getAttribute('href') || '').match(/(?:tLabels|tracknum|trackingNumber|tracknumbers)=([A-Z0-9]{8,})/i) || [])[1] || clean(trackLink.innerText)) : '';
    const actions = [...tr.querySelectorAll('button, a[role="button"]')].map((b) => clean(b.innerText || b.getAttribute('aria-label'))).filter((t) => t && t.length <= 40);
    out.push({
      key,
      shipmentNo: noOf(key),
      status,
      statusText: st ? clean(st.innerText) : clean(tr.innerText),
      items: parseInt(clean(cell(tr, ci.items) && cell(tr, ci.items).innerText), 10) || 0,
      tracking,
      actions,
      url: `${location.origin}/dashboard/shipments/${key}`,
    });
  }
  return out;
}

/**
 * 打开某个包裹后，右边的「Shipment」详情栏：包裹号、状态、每件商品（标题、图片、Whatnot 订单号）、按钮。
 * expectNo：要读的包裹号；详情栏显示的是别的包裹时返回 found:false（防止读错）。不读收件人姓名地址。
 */
export function whatnotShipmentDetail(expectNo) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const side = document.querySelector('[data-testid="shipment-details-sidebar"]')
    || [...document.querySelectorAll('aside, section, div')].find((el) => /^shipment\b/i.test(clean(el.innerText)) && /shipping actions/i.test(el.innerText || '') && el.querySelectorAll('a[href*="/dashboard/orders/"]').length);
  if (!side) return { found: false, why: '没有找到右边的 Shipment 详情栏' };
  const header = side.querySelector('[data-testid="shipment-header"]') || side;
  const htext = clean(header.innerText).slice(0, 200);
  const no = (htext.match(/#\s*(\d{5,})/) || [])[1] || '';
  if (expectNo && no && no !== String(expectNo)) return { found: false, wrong: no, why: `详情栏显示的是包裹 #${no}，不是 #${expectNo}` };
  const statusEl = header.querySelector('span');
  const status = statusEl ? clean(statusEl.innerText) : '';
  // 每件商品：带「Order #…」文字的订单链接（「Orders included」里只有数字的那些不算）
  const orderLinks = [...side.querySelectorAll('a[href*="/dashboard/orders/"]')].filter((a) => /order\s*#\s*\d+/i.test(clean(a.innerText)));
  const STATUS_WORD = /^(preparing package|needs label|label (created|printed|purchased)|shipped|delivered|in transit|cancell?ed|refunded|new)$/i;
  const items = orderLinks.map((a) => {
    let box = a;
    for (let n = a.parentElement; n && n !== side; n = n.parentElement) {
      if (orderLinks.some((x) => x !== a && n.contains(x))) break;
      box = n;
    }
    const img = [...box.querySelectorAll('img')].find((im) => /listings|images\.whatnot/i.test(im.currentSrc || im.src || '') || im.alt) || box.querySelector('img');
    const strongs = [...box.querySelectorAll('strong, b, h3, h4')].map((s) => String(s.innerText || '').trim())
      .filter((t) => t && !/\n/.test(t) && !/^order\s*#/i.test(t) && !STATUS_WORD.test(t));
    const title = clean((img && img.alt) || strongs[0] || '');
    const itemStatus = [...box.querySelectorAll('span')].map((s) => clean(s.innerText)).find((t) => STATUS_WORD.test(t)) || '';
    let imageUrl = img ? (img.currentSrc || img.src || '') : '';
    if (!/^https?:/.test(imageUrl)) imageUrl = '';
    return {
      title,
      orderNo: (clean(a.innerText).match(/(\d{5,})/) || [])[1] || '',
      orderUrl: a.href,
      imageUrl,
      itemStatus,
    };
  });
  const buttons = [...side.querySelectorAll('button, a[role="button"], a[href]')].filter(visible)
    .map((b) => clean(b.innerText || b.getAttribute('aria-label'))).filter((t) => t && t.length <= 40);
  return { found: true, shipmentNo: no, status, items, buttons: [...new Set(buttons)] };
}

/**
 * 在详情栏里找 / 点按钮。kind：
 *   'label' 打印 / 下载已经生成好的面单（Print Label、Reprint Label、Download Label…）
 *   'slip'  Generate Packing Slip
 * 安全：「Generate Label」会生成面单（不可撤销、包裹从此不能再合并别的订单），这里绝不点；
 * 带 buy / purchase / void / cancel / edit / upgrade 等字样的也不点。
 */
export function whatnotSidebarAction(mode, kind) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const side = document.querySelector('[data-testid="shipment-details-sidebar"]') || document.body;
  const BAD = /generate label|create label|get label|buy|purchase|pay\b|void|cancel|refund|edit|upgrade|unbundle|change|\$/i;
  const GOOD = kind === 'slip'
    ? /packing slip/i
    : /^((re-?)?print|download|view|open|show)( the)?( shipping)? label( pdf)?$|^label( pdf)?$/i;
  const els = [...side.querySelectorAll('button, a, [role="button"]')].filter((el) => visible(el) && GOOD.test(clean(el.innerText || el.getAttribute('aria-label'))) && !BAD.test(clean(el.innerText || el.getAttribute('aria-label'))));
  // 文字一样时取最内层（a 里面包着 button 的情况）
  const inner = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  if (!inner.length) return { found: false };
  const el = inner[0];
  const a = el.closest('a[href]');
  const href = a && /^https?:/.test(a.href) && !/\/dashboard\/shipments\//.test(a.href) ? a.href : '';
  const text = clean(el.innerText || el.getAttribute('aria-label'));
  if (mode !== 'click') return { found: true, href, text };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { found: true, clicked: true, href, text };
}

/**
 * packing slip 显示在页面里（弹窗或新标签页里的网页）时，读出它的文字。
 * 只取包含「Attributes」或「Packing Slip」的区块；没有返回空字符串。
 */
export function whatnotSlipText() {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument && f.contentDocument.body) docs.push(f.contentDocument); } catch { /* 跨站 iframe 读不到 */ } }
  for (const d of docs) {
    const dlg = [...d.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog')].find((el) => /packing slip|attributes/i.test(el.innerText || ''));
    if (dlg) return String(dlg.innerText || '');
  }
  for (const d of docs) {
    const t = String((d.body && d.body.innerText) || '');
    if (/attributes/i.test(t) && /packing slip|order\s*#|qty|quantity/i.test(t) && !d.querySelector('[data-testid="shipments-table-body"]')) return t;
  }
  return '';
}

// —— 以下是普通函数（在扩展页面里运行） ——

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
const SKU_RE = /^[A-Za-z0-9][\w.\-\/]{1,40}$/;

/** 商品标题里的 SKU：最后一个方括号（… [JC-159-10IN]） */
export function bracketSku(title) {
  const all = [...String(title || '').matchAll(/\[([A-Za-z0-9][\w.\-\/]{1,40})\]/g)];
  return all.length ? all[all.length - 1][1] : '';
}

/** Whatnot 状态：已经寄出 / 送达 / 取消的包裹不再打包 */
export const whatnotShipped = (status) => /^(delivered|shipped|in transit|out for delivery|accepted|picked up|cancell?ed|refunded|returned|return(ed)? to sender|completed|lost)\b/i.test(String(status || '').trim());
export const whatnotNeedsLabel = (status) => /needs? label/i.test(String(status || ''));

/** 商品小图换成大一点的（列表里是 96px 宽） */
export const whatnotBigImage = (u) => String(u || '').replace(/\/fit-in\/\d+x\d+\//, '/fit-in/480x0/');

/**
 * 从 packing slip 的文字里找每件商品的 SKU（Attributes 里「Fields」那一行）。
 * titles：这个包裹里每件商品的标题（按详情栏的顺序）。返回和 titles 一样长的数组，读不到的是 ''。
 * 对应规则：每个 Fields 归到它前面最近出现的那件商品；一件标题都找不到时，件数一样就按顺序对应。
 */
export function skusFromSlip(text, titles) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const fields = []; // { line, sku }
  lines.forEach((l, k) => {
    const m = l.match(/^(?:attributes\s*[:：]?\s*)?fields?\s*[:：]?\s*(.*)$/i);
    if (!m) return;
    let v = (m[1] || '').trim();
    if (!v) { // 值在下一行
      const nx = lines[k + 1] || '';
      if (!/^(attributes|fields?|qty|quantity|order|price|sku)\b/i.test(nx)) v = nx;
    }
    v = v.replace(/^sku\s*[:#]?\s*/i, '').replace(/[,;]+$/, '').trim();
    if (/\s/.test(v)) v = v.split(/\s+/).find((x) => SKU_RE.test(x) && /\d/.test(x)) || '';
    if (v && SKU_RE.test(v)) fields.push({ line: k, sku: v });
  });
  const out = titles.map(() => '');
  if (!fields.length) return out;
  // 每件商品的标题在第几行出现（只比前 30 个字符，标题可能在 slip 里被截断或换行）
  const pos = titles.map((t) => {
    const key = norm(t).slice(0, 30);
    if (key.length < 6) return -1;
    return lines.findIndex((l) => norm(l).startsWith(key) || (norm(l).length >= 12 && key.startsWith(norm(l).slice(0, 30))));
  });
  if (pos.some((p) => p >= 0)) {
    for (const f of fields) {
      let best = -1;
      pos.forEach((p, i) => { if (p >= 0 && p <= f.line && (best < 0 || p > pos[best])) best = i; });
      if (best >= 0 && !out[best]) out[best] = f.sku;
    }
    return out;
  }
  if (fields.length === titles.length) return fields.map((f) => f.sku);
  if (titles.length === 1) out[0] = fields[0].sku;
  return out;
}

/**
 * 从 PDF 里取出文字（够读 packing slip 用）：解压 FlateDecode 流，读 Tj / TJ 里的字符串；
 * 有 ToUnicode 对照表时按表把字形编号换成文字。读不出来返回 ''。
 */
export async function pdfText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const latin = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return s; };
  const raw = latin(u8);
  const inflate = async (data) => {
    try {
      const ds = new DecompressionStream('deflate');
      const out = new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(await out);
    } catch { return null; }
  };
  const streams = [];
  const re = /<<((?:[^<>]|<<(?:[^<>]|<<[^<>]*>>)*>>|<[0-9A-Fa-f\s]*>)*)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const lenM = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let end = lenM ? start + parseInt(lenM[1], 10) : -1;
    if (end < 0 || raw.slice(end, end + 12).indexOf('endstream') < 0) end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const data = u8.subarray(start, end);
    let text = '';
    if (/\/FlateDecode/.test(dict)) { const d = await inflate(data); if (d) text = latin(d); } else if (!/\/Filter/.test(dict)) text = latin(data);
    if (text) streams.push(text);
    re.lastIndex = end;
  }
  // ToUnicode 对照表（所有字体合在一起：不同字体的同一编号可能冲突，够用就好）
  const cmap = new Map();
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4))); return s || String.fromCharCode(hex(h)); };
  for (const s of streams) {
    if (!/begincmap/.test(s)) continue;
    for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) cmap.set(hex(p[1]), uni(p[2]));
    }
    for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
        const a = hex(p[1]); const b = hex(p[2]);
        if (b - a > 5000) continue;
        if (p[4]) { const base = hex(p[4]); for (let c = a; c <= b; c++) cmap.set(c, String.fromCharCode(base + (c - a))); } else {
          const list = [...p[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1]));
          for (let c = a; c <= b && c - a < list.length; c++) cmap.set(c, list[c - a]);
        }
      }
    }
  }
  const decodeHex = (h) => {
    h = h.replace(/\s+/g, '');
    if (cmap.size) {
      const two = h.length % 4 === 0 && [...cmap.keys()].some((k) => k > 255);
      const step = two ? 4 : 2;
      let s = '';
      for (let i = 0; i + step <= h.length; i += step) { const c = hex(h.slice(i, i + step)); s += cmap.has(c) ? cmap.get(c) : (step === 2 ? String.fromCharCode(c) : ''); }
      return s;
    }
    let s = '';
    for (let i = 0; i + 2 <= h.length; i += 2) s += String.fromCharCode(hex(h.slice(i, i + 2)));
    return s;
  };
  const decodeLit = (lit) => {
    const s = lit.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (x, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c] ?? String.fromCharCode(parseInt(c, 8))));
    if (!cmap.size) return s;
    let out = '';
    for (const ch of s) { const c = ch.charCodeAt(0); out += cmap.has(c) ? cmap.get(c) : ch; }
    return out;
  };
  const lines = [];
  for (const s of streams) {
    if (!/\bBT\b/.test(s) || /begincmap/.test(s)) continue;
    let cur = '';
    let lastY = null;
    const tok = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/<>()[\]]+|[A-Za-z'"*]+/g;
    const stack = [];
    let t;
    while ((t = tok.exec(s)) !== null) {
      const v = t[0];
      if (v[0] === '(') stack.push({ s: decodeLit(v.slice(1, -1)) });
      else if (v[0] === '<') stack.push({ s: decodeHex(v.slice(1, -1)) });
      else if (v === '[') stack.push({ arr: true });
      else if (v === ']') {
        const parts = [];
        while (stack.length && !stack[stack.length - 1].arr) parts.unshift(stack.pop());
        stack.pop();
        stack.push({ s: parts.map((p) => (p.s !== undefined ? p.s : (p.n < -200 ? ' ' : ''))).join('') });
      } else if (/^-?\d*\.?\d+$/.test(v)) stack.push({ n: parseFloat(v) });
      else if (v === 'Tj' || v === 'TJ' || v === "'" || v === '"') {
        const top = [...stack].reverse().find((x) => x.s !== undefined);
        if (v === "'" || v === '"') { lines.push(cur); cur = ''; }
        if (top) cur += top.s;
        stack.length = 0;
      } else if (v === 'Td' || v === 'TD' || v === 'Tm') {
        const nums = stack.filter((x) => x.n !== undefined).map((x) => x.n);
        const y = v === 'Tm' ? nums[5] : nums[1];
        if (v === 'Tm' ? (lastY === null || Math.abs(y - lastY) > 1) : Math.abs(y || 0) > 1) { if (cur) lines.push(cur); cur = ''; } else if (cur && !/\s$/.test(cur)) cur += ' ';
        if (v === 'Tm') lastY = y;
        stack.length = 0;
      } else if (v === 'T*' || v === 'ET') { if (cur) lines.push(cur); cur = ''; stack.length = 0; } else stack.length = 0;
    }
    if (cur) lines.push(cur);
  }
  return lines.map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim()).filter(Boolean).join('\n');
}

// —— 读 packing slip（一键拉取和售出同步共用） ——

/** 读取已经下载到电脑上的文件（扩展页面里才能用；需要「允许访问文件网址」） */
function readLocalFile(fullPath) {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') { reject(new Error('NO_XHR')); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'file://' + fullPath.split('/').map(encodeURIComponent).join('/'));
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => (xhr.response ? resolve(new Uint8Array(xhr.response)) : reject(new Error('空文件')));
    xhr.onerror = () => reject(new Error('NO_FILE_ACCESS'));
    xhr.send();
  });
}

const b64ToU8 = (b64) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };

/** 网址指向 PDF 时读出里面的文字；不是 PDF 返回 ''（网页交给页面里的 whatnotSlipText 读） */
async function slipTextFromUrl(url) {
  const r = await fetch(url, { credentials: 'include' });
  const u8 = new Uint8Array(await r.arrayBuffer());
  return isPdfBytes(u8) ? pdfText(u8) : '';
}

/**
 * 点「Generate Packing Slip」，读出 packing slip 的文字。slip 可能是弹窗、新标签页里的网页、
 * 新标签页 / 网页里生成的 PDF、或者直接下载的 PDF，几种都试。返回 { text, how, why }
 */
export async function readWhatnotSlip(tabId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (id, func, args = [], world) => (await chrome.scripting.executeScript({ target: { tabId: id }, func, args, ...(world ? { world } : {}) }))[0].result;
  const runMain = (id, func, args = []) => run(id, func, args, 'MAIN');
  const closeTab = (id) => chrome.tabs.remove(id).catch(() => {});
  const found = await run(tabId, whatnotSidebarAction, ['find', 'slip']).catch(() => null);
  if (!found || !found.found) return { text: '', why: '详情栏里没找到「Generate Packing Slip」按钮' };
  const t0 = Date.now();
  const newTabs = new Set();
  const dls = new Set();
  const onCreated = (tab) => { if (tab.openerTabId === tabId || tab.openerTabId === undefined) newTabs.add(tab.id); };
  const onDl = (item) => dls.add(item.id);
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.downloads.onCreated.addListener(onDl);
  let text = '';
  let how = '';
  try {
    if (found.href) { try { text = await slipTextFromUrl(found.href); how = '链接'; } catch { /* 改为点击 */ } }
    if (!text) {
      await runMain(tabId, installBlobHook).catch(() => {});
      await run(tabId, whatnotSidebarAction, ['click', 'slip']);
    }
    for (let k = 0; k < 20 && !text; k++) {
      await sleep(750);
      text = (await run(tabId, whatnotSlipText).catch(() => '')) || '';
      if (text) { how = '弹窗'; break; }
      const b64 = await runMain(tabId, readHookedBlob).catch(() => null);
      if (b64) { const u8 = b64ToU8(b64); if (isPdfBytes(u8)) { text = await pdfText(u8); how = '网页生成的 PDF'; } if (text) break; }
      for (const id of newTabs) {
        const tab = await chrome.tabs.get(id).catch(() => null);
        const url = tab ? (tab.url || tab.pendingUrl || '') : '';
        if (!/^https?:/.test(url)) continue;
        try { text = await slipTextFromUrl(url); how = '新标签页的 PDF'; } catch { /* 读网页 */ }
        if (!text && tab.status === 'complete') { text = (await run(id, whatnotSlipText).catch(() => '')) || ''; how = '新标签页'; }
        if (text) break;
      }
      if (text) break;
      for (const id of dls) {
        const [it] = await chrome.downloads.search({ id });
        if (!it || it.state !== 'complete') continue;
        let u8 = null;
        try { if (/^https?:/.test(it.finalUrl || it.url)) { const r = await fetch(it.finalUrl || it.url, { credentials: 'include' }); u8 = new Uint8Array(await r.arrayBuffer()); } } catch { /* 读本地文件 */ }
        if (!u8 || !isPdfBytes(u8)) { try { u8 = await readLocalFile(it.filename); } catch { u8 = null; } } // 后台（service worker）里读不了本地文件，就算了
        if (u8 && isPdfBytes(u8)) { text = await pdfText(u8); how = '下载的 PDF'; }
        if (text) break;
      }
    }
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.downloads.onCreated.removeListener(onDl);
    for (const id of newTabs) closeTab(id);
    // packing slip 不是面单：后台可能把下载的 slip 放进了「待分配面单」，清掉
    setTimeout(async () => {
      for (const p of await getPool()) if (p.at >= t0 && (p.platform === 'whatnot' || !p.platform)) await removeFromPool(p.id);
    }, 2500);
  }
  return { text, how, why: text ? '' : '点了「Generate Packing Slip」，15 秒内没读到 packing slip 的内容' };
}

