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
 * 从 packing slip 的文字里找每件商品的 SKU。
 * 真实的 slip（2026-10）：Attributes 那一栏每件写「Order 1451598434」，下一行「SKU JC-16-10IN」。
 * 优先按 Whatnot 订单号对应（最准）；没有订单号时退回老办法：Fields / SKU 行归到它前面最近的那件商品标题。
 * titles、orderNos：这个包裹里每件商品的标题和订单号（按详情栏的顺序）。返回同样长的数组，读不到的是 ''。
 */
export function skusFromSlip(text, titles, orderNos = []) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // ① 按订单号：「Order 123」之后、下一个「Order」之前的「SKU xxx」
  const byOrder = {};
  let curOrder = '';
  for (const l of lines) {
    const o = l.match(/^order\s*#?\s*(\d{5,})\b/i);
    if (o) { curOrder = o[1]; continue; }
    const k = l.match(/^(?:sku|fields?)\s*[:：#]?\s*([A-Za-z0-9][\w.\-\/]{1,40})$/i);
    if (k && curOrder && !byOrder[curOrder]) byOrder[curOrder] = k[1];
  }
  if (orderNos.some((n) => n && byOrder[n])) return titles.map((_, i) => byOrder[orderNos[i]] || '');
  const fields = []; // { line, sku }
  lines.forEach((l, k) => {
    const m = l.match(/^(?:attributes\s*[:：]?\s*)?(?:fields?|sku)\s*[:：#]?\s*(.*)$/i);
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
 * 从 PDF 里取出文字（够读 packing slip 用）。按页读内容流，跟着「Tf」切换字体，
 * 每个字体用它自己的 ToUnicode 对照表把字形编号换成文字（不同字体的编号会重复，不能混用）。
 * 支持 FlateDecode 压缩和对象流（ObjStm）。读不出来返回 ''。
 */
export async function pdfText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const latin = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return s; };
  const inflate = async (data) => {
    try {
      const ds = new DecompressionStream('deflate');
      return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    } catch { return null; }
  };

  // —— 极简 PDF 对象解析：字典 / 数组 / 名字 / 数字 / 字符串 / 引用 ——
  function parseObj(str, pos = 0) {
    const ws = () => { for (;;) { while (pos < str.length && /[\s\0]/.test(str[pos])) pos++; if (str[pos] === '%') { while (pos < str.length && !/[\r\n]/.test(str[pos])) pos++; } else break; } };
    function val() {
      ws();
      const c = str[pos];
      if (c === '<' && str[pos + 1] === '<') {
        pos += 2; const o = {};
        for (;;) { ws(); if (str[pos] === '>' && str[pos + 1] === '>') { pos += 2; return o; } if (pos >= str.length) return o; const k = val(); if (!k || k.name === undefined) { pos++; continue; } o[k.name] = val(); }
      }
      if (c === '[') { pos++; const a = []; for (;;) { ws(); if (str[pos] === ']') { pos++; return a; } if (pos >= str.length) return a; a.push(val()); } }
      if (c === '/') { const m = str.slice(pos).match(/^\/([^\s/<>()[\]{}%]*)/); pos += m[0].length; return { name: m[1] }; }
      if (c === '(') { let d = 0; const st = pos; for (; pos < str.length; pos++) { if (str[pos] === '\\') { pos++; continue; } if (str[pos] === '(') d++; else if (str[pos] === ')' && --d === 0) { pos++; break; } } return { str: str.slice(st + 1, pos - 1) }; }
      if (c === '<') { const e = str.indexOf('>', pos); const h = str.slice(pos + 1, e); pos = e + 1; return { hex: h }; }
      const m = str.slice(pos, pos + 40).match(/^(-?\d+)\s+(\d+)\s+R\b/);
      if (m) { pos += m[0].length; return { ref: +m[1] }; }
      const n = str.slice(pos, pos + 40).match(/^[+-]?(\d+\.?\d*|\.\d+)/);
      if (n) { pos += n[0].length; return +n[0]; }
      const w = str.slice(pos, pos + 20).match(/^[a-z]+/i);
      if (w) { pos += w[0].length; return w[0] === 'true' ? true : w[0] === 'false' ? false : null; }
      pos++; return null;
    }
    const v = val();
    return { v, pos };
  }

  const raw = latin(u8);
  const objs = new Map(); // 编号 → { dict, data(解压后的 Uint8Array) }
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  const pendingLen = [];
  while ((m = objRe.exec(raw)) !== null) {
    const num = +m[1];
    let r;
    try { r = parseObj(raw, m.index + m[0].length); } catch { continue; }
    const o = { v: r.v };
    const after = raw.slice(r.pos, r.pos + 20).match(/^\s*stream\r?\n/);
    if (after && r.v && typeof r.v === 'object') {
      const start = r.pos + after[0].length;
      o.start = start;
      pendingLen.push(o);
      const endIdx = raw.indexOf('endstream', start);
      o.end = endIdx < 0 ? start : endIdx;
      objRe.lastIndex = o.end;
    }
    if (!objs.has(num)) objs.set(num, o);
  }
  const get = (x) => (x && x.ref !== undefined ? (objs.get(x.ref) || {}).v : x);
  async function data(o) {
    if (!o || o.start === undefined) return null;
    if (o.data) return o.data;
    let len = get(o.v.Length);
    let end = typeof len === 'number' && raw.slice(o.start + len, o.start + len + 12).indexOf('endstream') >= 0 ? o.start + len : o.end;
    while (end > o.start && /[\r\n]/.test(raw[end - 1])) end--;
    let d = u8.subarray(o.start, end);
    const f = get(o.v.Filter);
    const fl = [].concat(f || []).map((x) => x && x.name);
    if (fl.includes('FlateDecode')) { const x = await inflate(d); if (!x) { const y = await inflate(u8.subarray(o.start, o.end)); d = y || new Uint8Array(); } else d = x; } else if (fl.length) d = new Uint8Array();
    o.data = d;
    return d;
  }
  // 对象流里的对象
  for (const [, o] of [...objs]) {
    if (!o.v || !o.v.Type || o.v.Type.name !== 'ObjStm') continue;
    const d = await data(o);
    if (!d) continue;
    const s = latin(d);
    const first = get(o.v.First) || 0;
    const head = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < head.length; k += 2) {
      if (objs.has(head[k])) continue;
      try { objs.set(head[k], { v: parseObj(s, first + head[k + 1]).v }); } catch { /* 跳过 */ }
    }
  }

  // —— 字体：ToUnicode 对照表 ——
  const hexN = (h) => parseInt(h, 16);
  const uni = (h) => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hexN(h.slice(i, i + 4))); return s || String.fromCharCode(hexN(h)); };
  const fontCache = new Map();
  async function fontInfo(ref) {
    const key = ref && ref.ref !== undefined ? ref.ref : null;
    if (key !== null && fontCache.has(key)) return fontCache.get(key);
    const f = get(ref) || {};
    const info = { map: null, bytes: (f.Subtype && f.Subtype.name === 'Type0') ? 2 : 1 };
    const tu = f.ToUnicode && f.ToUnicode.ref !== undefined ? objs.get(f.ToUnicode.ref) : null;
    const d = tu ? await data(tu) : null;
    if (d) {
      const s = latin(d);
      const map = new Map();
      const cs = s.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
      if (cs) info.bytes = cs[1].length / 2;
      for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(hexN(p[1]), uni(p[2]));
      for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
          const a = hexN(p[1]); const b = hexN(p[2]);
          if (b - a > 65535) continue;
          if (p[3] !== undefined) { const base = uni(p[3]); const last = base.charCodeAt(base.length - 1); for (let c = a; c <= b; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - a))); } else {
            const list = [...p[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1]));
            for (let c = a; c <= b && c - a < list.length; c++) map.set(c, list[c - a]);
          }
        }
      }
      info.map = map;
    }
    if (key !== null) fontCache.set(key, info);
    return info;
  }
  const decode = (bytesStr, font) => {
    if (!font || !font.map) return bytesStr; // 普通字体（WinAnsi 等）：按字节就是文字
    let out = '';
    const n = font.bytes || 1;
    for (let i = 0; i + n <= bytesStr.length; i += n) {
      let c = 0;
      for (let k = 0; k < n; k++) c = c * 256 + bytesStr.charCodeAt(i + k);
      out += font.map.has(c) ? font.map.get(c) : (n === 1 ? bytesStr[i] : '');
    }
    return out;
  };
  const litBytes = (lit) => lit.replace(/\\(\r\n|\r|\n)/g, '').replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (x, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? String.fromCharCode(parseInt(c, 8) & 255)));
  const hexBytes = (h) => { h = h.replace(/\s+/g, ''); if (h.length % 2) h += '0'; let s = ''; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(hexN(h.slice(i, i + 2))); return s; };

  // —— 读一段内容流 ——
  async function contentText(s, fonts, lines, depth, xobjects) {
    let cur = '';
    let font = null;
    let lastY = null;
    const tok = /\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/<>()[\]%]+|[A-Za-z'"*]+[0-9]?/g;
    const stack = [];
    let t;
    const flush = () => { if (cur.trim()) lines.push(cur); cur = ''; };
    while ((t = tok.exec(s)) !== null) {
      const v = t[0];
      if (v[0] === '(') stack.push({ b: litBytes(v.slice(1, -1)) });
      else if (v === '<<' || v === '>>') continue;
      else if (v[0] === '<') stack.push({ b: hexBytes(v.slice(1, -1)) });
      else if (v === '[') stack.push({ arr: true });
      else if (v === ']') {
        const parts = [];
        while (stack.length && !stack[stack.length - 1].arr) parts.unshift(stack.pop());
        stack.pop();
        stack.push({ s: parts.map((p) => (p.b !== undefined ? decode(p.b, font) : (p.n < -200 ? ' ' : ''))).join('') });
      } else if (v[0] === '/') stack.push({ name: v.slice(1) });
      else if (/^-?\d*\.?\d+$/.test(v)) stack.push({ n: parseFloat(v) });
      else if (v === 'Tf') {
        const nm = [...stack].reverse().find((x) => x.name);
        font = nm ? (fonts[nm.name] || null) : null;
        stack.length = 0;
      } else if (v === 'Tj' || v === 'TJ' || v === "'" || v === '"') {
        const top = [...stack].reverse().find((x) => x.s !== undefined || x.b !== undefined);
        if (v === "'" || v === '"') flush();
        if (top) cur += top.s !== undefined ? top.s : decode(top.b, font);
        stack.length = 0;
      } else if (v === 'Td' || v === 'TD' || v === 'Tm') {
        const nums = stack.filter((x) => x.n !== undefined).map((x) => x.n);
        const y = v === 'Tm' ? nums[5] : nums[1];
        if (v === 'Tm' ? (lastY === null || Math.abs(y - lastY) > 1) : Math.abs(y || 0) > 1) flush(); else if (cur && !/\s$/.test(cur)) cur += ' ';
        if (v === 'Tm') lastY = y;
        stack.length = 0;
      } else if (v === 'T*' || v === 'ET') { flush(); stack.length = 0; } else if (v === 'Do' && depth < 3) {
        const nm = [...stack].reverse().find((x) => x.name);
        const xo = nm && xobjects[nm.name];
        if (xo) await formText(xo, lines, depth + 1);
        stack.length = 0;
      } else stack.length = 0;
    }
    flush();
  }
  async function resourcesOf(res) {
    const r = get(res) || {};
    const fd = get(r.Font) || {};
    const fonts = {};
    for (const [k, ref] of Object.entries(fd)) fonts[k] = await fontInfo(ref);
    const xd = get(r.XObject) || {};
    const xobjects = {};
    for (const [k, ref] of Object.entries(xd)) if (ref && ref.ref !== undefined) xobjects[k] = objs.get(ref.ref);
    return { fonts, xobjects };
  }
  async function formText(o, lines, depth) {
    if (!o || !o.v || !o.v.Subtype || o.v.Subtype.name !== 'Form') return;
    const d = await data(o);
    if (!d) return;
    const { fonts, xobjects } = await resourcesOf(o.v.Resources);
    await contentText(latin(d), fonts, lines, depth, xobjects);
  }

  const lines = [];
  // 页面按页树顺序
  const pages = [];
  const walk = (node, inherited, depth) => {
    const n = get(node);
    if (!n || depth > 30) return;
    const res = n.Resources || inherited;
    if (n.Type && n.Type.name === 'Page') { pages.push({ n, res }); return; }
    for (const k of [].concat(get(n.Kids) || [])) walk(k, res, depth + 1);
  };
  const root = [...objs.values()].find((o) => o.v && o.v.Type && o.v.Type.name === 'Catalog');
  if (root) walk(root.v.Pages, null, 0);
  if (!pages.length) for (const o of objs.values()) if (o.v && o.v.Type && o.v.Type.name === 'Page') pages.push({ n: o.v, res: o.v.Resources });
  for (const pg of pages) {
    const { fonts, xobjects } = await resourcesOf(pg.res);
    for (const c of [].concat(pg.n.Contents || [])) {
      const o = c && c.ref !== undefined ? objs.get(c.ref) : null;
      const d = await data(o);
      if (d) await contentText(latin(d), fonts, lines, 0, xobjects);
    }
  }
  return lines.map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
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

/** Whatnot packing slip 的网址（S3 上的 PDF，文件名 Whatnot-Packing-Slips-…pdf） */
export const isSlipUrl = (u) => /whatnot-shipping-pdf|\/packing_slips?\/|packing-slips?/i.test(String(u || ''));

/**
 * 点了「Generate Packing Slip」之后一段时间内新开的标签页：是 slip 就关掉。
 * Whatnot 从后台标签页打开 slip 时，Chrome 记下的「来源标签页」是当时在前台的那个标签页，
 * 不是包裹页，所以不能按来源判断，只能按网址认。slip 有时晚几秒才打开，所以读完以后还要再盯一会儿。
 */
function watchSlipTabs(ms) {
  const ids = new Set();
  const closeIfSlip = (id, url) => { if (isSlipUrl(url)) chrome.tabs.remove(id).catch(() => {}); };
  const onCreated = (tab) => { ids.add(tab.id); closeIfSlip(tab.id, tab.pendingUrl || tab.url); };
  const onUpdated = (id, info, tab) => { if (ids.has(id)) closeIfSlip(id, info.url || tab.url || tab.pendingUrl); };
  chrome.tabs.onCreated.addListener(onCreated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  setTimeout(async () => {
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    for (const id of ids) { const t = await chrome.tabs.get(id).catch(() => null); if (t) closeIfSlip(id, t.url || t.pendingUrl); }
  }, ms);
}

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
  // 这期间新开的标签页都记下来（来源标签页不可靠，见 watchSlipTabs），读取时只读、关闭时只关 slip 网址或来源是包裹页的
  const onCreated = (tab) => newTabs.add(tab.id);
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
        if (!/^https?:/.test(url) || !(isSlipUrl(url) || tab.openerTabId === tabId)) continue;
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
    for (const id of newTabs) {
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (tab && (isSlipUrl(tab.url || tab.pendingUrl) || tab.openerTabId === tabId)) closeTab(id);
    }
    watchSlipTabs(45000); // 晚开的 slip 也关掉
    // packing slip 不是面单：后台可能把下载的 slip 放进了「待分配面单」，清掉
    setTimeout(async () => {
      for (const p of await getPool()) if (p.at >= t0 && (p.platform === 'whatnot' || !p.platform)) await removeFromPool(p.id);
    }, 2500);
  }
  return { text, how, why: text ? '' : '点了「Generate Packing Slip」，15 秒内没读到 packing slip 的内容' };
}

