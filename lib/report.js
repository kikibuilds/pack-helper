// 生成打包清单（HTML + CSV）和面单文件名。纯函数，不依赖浏览器 API，方便测试。

export const PLATFORM_ORDER = ['ebay', 'poshmark', 'mercari', 'depop', 'other'];
export const PLATFORM_META = {
  ebay: { name: 'eBay', prefix: 'E', color: '#2563eb' },
  poshmark: { name: 'Poshmark', prefix: 'P', color: '#b91c1c' },
  mercari: { name: 'Mercari', prefix: 'M', color: '#6d28d9' },
  depop: { name: 'Depop', prefix: 'D', color: '#111827' },
  other: { name: '其他', prefix: 'X', color: '#6b7280' },
};

export function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || '无单号';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 给每个包裹分配编号（E01、P01…）。同一订单号的多行（多件订单）共用一个编号和一张面单。
 * 返回按打包顺序排好的行，每行带 code、labelFile（无面单时为空）、labelOwnerId。
 */
// —— 邮件标题和正文模板（可在「设置 → 邮件」里改，留空 = 用默认） ——
export const DEFAULT_EMAIL_SUBJECT = '[发货] {日期} · {包裹数} 个包裹';
export const DEFAULT_EMAIL_BODY = [
  '这次一共 {包裹数} 个包裹、{件数} 件商品。',
  '{缺面单提醒}',
  '',
  '1. 下载附件「{附件}」并解压',
  '2. 打印「打印-面单带对照卡.pdf」',
  '3. 按对照卡拣货、装袋、贴面单（遇到问题看「使用说明.txt」）',
].join('\n');
export const EMAIL_FIELDS = [
  ['{日期}', '打包日期，例如 10/14'],
  ['{包裹数}', '包裹个数'],
  ['{件数}', '商品总件数'],
  ['{附件}', '附件 zip 的文件名'],
  ['{缺面单提醒}', '有缺面单时变成「⚠ D05 还没有面单，这几个包裹先不要发。」，没有时这一行自动去掉'],
  ['{包裹清单}', '每个包裹的编号、SKU × 数量、商品名（包裹多时邮件会很长，默认不放）'],
];

/** 按模板生成邮件标题和正文 */
export function buildEmail(rows, zipName, date, { subject, body } = {}) {
  const packages = new Set(rows.map((r) => r.code)).size;
  const units = rows.reduce((s, r) => s + r.qty, 0);
  const missing = [...new Set(rows.filter((r) => !r.labelFile).map((r) => r.code))];
  const clean = (r) => {
    let t = String(r.title || '').replace(/\s+/g, ' ').trim();
    if (r.sku) t = t.split(`[${r.sku}]`).join('').replace(/\s+/g, ' ').trim();
    return t.length > 70 ? `${t.slice(0, 68)}…` : t;
  };
  let last = '';
  const list = rows.map((r) => {
    const code = r.code !== last ? `${r.code}${r.labelFile ? '' : '（缺面单）'}` : '';
    last = r.code;
    return `${code.padEnd(4)}  ${r.sku || '无SKU'} × ${r.qty}  ${clean(r)}`;
  }).join('\n');
  const vals = {
    '{日期}': String(date || '').slice(5).replace('-', '/'),
    '{包裹数}': String(packages),
    '{件数}': String(units),
    '{附件}': zipName,
    '{缺面单提醒}': missing.length ? `⚠ ${missing.join('、')} 还没有面单，这几个包裹先不要发。` : '',
    '{包裹清单}': list,
  };
  const fill = (tpl) => Object.entries(vals).reduce((s, [k, v]) => s.split(k).join(v), tpl);
  // 只有占位符、展开后为空的行直接去掉
  const bodyTpl = (body && body.trim()) ? body : DEFAULT_EMAIL_BODY;
  const bodyText = bodyTpl.split('\n')
    .filter((line) => !(line.trim() && fill(line).trim() === '' && /\{[^}]+\}/.test(line)))
    .map(fill).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let subj = fill((subject && subject.trim()) ? subject.trim() : DEFAULT_EMAIL_SUBJECT).replace(/\s+/g, ' ');
  if (missing.length && !/缺面单/.test(subj)) subj += '（有缺面单，先别发）';
  return { subject: subj, body: bodyText };
}

export function assignCodes(orders) {
  const sorted = [...orders].sort((a, b) =>
    PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || a.addedAt - b.addedAt);
  const groups = new Map();
  for (const o of sorted) {
    const key = `${o.platform}|${o.orderId || o.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const counters = {};
  const rows = [];
  for (const items of groups.values()) {
    const p = PLATFORM_META[items[0].platform] ? items[0].platform : 'other';
    counters[p] = (counters[p] || 0) + 1;
    const code = `${PLATFORM_META[p].prefix}${String(counters[p]).padStart(2, '0')}`;
    const owner = items.find((o) => o.hasLabel);
    const labelFile = owner ? `面单/${code}_${PLATFORM_META[p].name}_${safeName(items[0].orderId)}.${owner.labelExt || 'pdf'}` : '';
    const last4 = items.map((o) => o.trackingLast4).find(Boolean) || '';
    items.forEach((o, i) => rows.push({
      ...o,
      platform: p,
      code,
      itemIndex: i + 1,
      itemCount: items.length,
      labelFile,
      labelOwnerId: owner ? owner.id : '',
      trackingLast4: last4,
    }));
  }
  return rows;
}

/** 按 SKU（没有 SKU 时按商品名）汇总数量，方便先一次性拣齐货。 */
export function summarize(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.sku ? `sku:${r.sku.toLowerCase()}` : `title:${r.title.toLowerCase()}`;
    if (!map.has(key)) map.set(key, { sku: r.sku, title: r.title, rowId: r.id, imageUrl: r.imageUrl, qty: 0, codes: [] });
    const s = map.get(key);
    s.qty += r.qty;
    if (!s.codes.includes(r.code)) s.codes.push(r.code);
  }
  return [...map.values()].sort((a, b) => (a.sku || '~' + a.title).localeCompare(b.sku || '~' + b.title));
}

/**
 * @param rows assignCodes 的结果
 * @param images { [orderRowId]: dataURL }，缺失时用 imageUrl
 */
export function buildPickSheetHtml(rows, images, dateLabel, sheetId = '', ownerEmail = '') {
  const img = (id, url) => {
    const src = images[id] || url;
    return src ? `<img src="${esc(src)}" alt="">` : '<div class="noimg">无图</div>';
  };
  const packages = new Set(rows.map((r) => r.code)).size;
  const units = rows.reduce((s, r) => s + r.qty, 0);
  const missing = [...new Set(rows.filter((r) => !r.labelFile).map((r) => r.code))];
  const unitsOf = {};
  for (const r of rows) unitsOf[r.code] = (unitsOf[r.code] || 0) + r.qty;
  // 面单链接用相对路径：解压后「打包清单.html」和「面单」文件夹在一起，点了就能打开
  const labelHref = (f) => f.split('/').map(encodeURIComponent).join('/');
  // 平台上的订单页：优先用拉取时记下的地址，没有就按平台规则拼
  const orderUrl = (r) => {
    if (/^https?:\/\//.test(r.url || '') && /order|transaction|sold-items|receipt/i.test(r.url)) return r.url;
    const id = encodeURIComponent(r.orderId || '');
    if (!id) return '';
    return { poshmark: `https://poshmark.com/order/sales/${id}`, mercari: `https://www.mercari.com/transaction/order_status/${id}/`,
      depop: `https://www.depop.com/sellinghub/sold-items/${id}/` }[r.platform] || '';
  };
  const box = (k, text, cls = '') => `<label class="cb ${cls}"><input type="checkbox" data-k="${esc(k)}"><span>${text}</span></label>`;

  const groups = new Map(); // 编号 → 这个包裹的几行
  rows.forEach((r) => {
    const meta = PLATFORM_META[r.platform];
    const first = r.itemIndex === 1;
    const span = r.itemCount > 1 ? ` rowspan="${r.itemCount}"` : '';
    const pkgCells = first ? `
      <td class="done"${span}>${box(`pack:${r.code}`, '已打包')}${box(`issue:${r.code}`, '有问题', 'bad')}</td>
      <td class="code"${span} style="border-left:6px solid ${meta.color}">${esc(r.code)}<div class="plat">${esc(meta.name)}</div>${r.itemCount > 1 || r.qty > 1 ? `<div class="multi">共 ${unitsOf[r.code]} 件</div>` : ''}</td>
      <td class="oid"${span}>${r.orderId ? (orderUrl(r) ? `<a href="${esc(orderUrl(r))}" target="_blank">${esc(r.orderId)}</a>` : esc(r.orderId)) : '<span class="muted">—</span>'}</td>` : '';
    const tailCells = first ? `
      <td class="label"${span}>${r.labelFile ? `<a href="${esc(labelHref(r.labelFile))}" target="_blank">打开面单</a>` : '<span class="warn">缺面单<br>先不要发</span>'}</td>
      <td class="note"${span}><div contenteditable="true" data-k="note:${esc(r.code)}"></div></td>` : '';
    const html = `
    <tr class="${first ? 'first' : 'cont'}" data-code="${esc(r.code)}" data-item="${esc(JSON.stringify({ sku: r.sku || '无SKU', qty: r.qty, title: String(r.title || '').slice(0, 40) }))}">${pkgCells}
      <td class="img">${img(r.id, r.imageUrl)}</td>
      <td class="title">${esc(r.title) || '<span class="muted">（未填商品名）</span>'}</td>
      <td class="sku">${esc(r.sku) || '<span class="muted">无 SKU</span>'}</td>
      <td class="qty${r.qty > 1 ? ' many' : ''}">${r.qty}</td>
      <td class="picked">${box(`pick:${r.code}:${r.itemIndex}`, '已拣货')}${box(`oos:${r.code}:${r.itemIndex}`, '缺货', 'bad')}</td>${tailCells}
    </tr>`;
    if (!groups.has(r.code)) groups.set(r.code, { orderId: r.orderId, url: orderUrl(r), platform: PLATFORM_META[r.platform].name, labelFile: r.labelFile, rows: [] });
    groups.get(r.code).rows.push(html);
  });
  // 每个包裹一个 tbody：打印时不会把同一个包裹拆到两页
  const body = [...groups.entries()].map(([code, g]) =>
    `<tbody data-code="${esc(code)}" data-oid="${esc(g.orderId || '')}" data-url="${esc(g.url)}" data-plat="${esc(g.platform)}" data-nolabel="${g.labelFile ? '' : '1'}">${g.rows.join('')}</tbody>`).join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>打包清单 ${esc(dateLabel)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 13px; }
  .progress { font-weight: 700; color: #047857; margin-left: 8px; }
  .alert { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 8px 12px; border-radius: 6px; margin-top: 12px; font-size: 14px; }
  .tips { font-size: 13px; color: #374151; line-height: 1.7; margin: 8px 0 12px; }
  .bar { margin: 6px 0 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
  button.go { background: #047857; border-color: #047857; color: #fff; font-weight: 600; }
  #result { display: none; border: 2px solid #047857; border-radius: 8px; padding: 12px 16px; margin: 0 0 16px; background: #f0fdf4; }
  #result.show { display: block; }
  #result h2 { font-size: 17px; margin: 0 0 4px; }
  #result .sum { font-size: 14px; margin-bottom: 8px; }
  #result table { background: #fff; margin-bottom: 10px; }
  #result td { vertical-align: top; }
  #result tr.fine td { background: #f0fdf4; }
  #result tr.fine-item td { background: #f9fafb; font-size: 13px; }
  #result a.toggle { font-size: 13px; margin-left: 6px; }
  @media print { #result a.toggle { display: none; } }
  .st { font-weight: 700; white-space: nowrap; }
  .st.ok { color: #047857; } .st.bad { color: #b91c1c; } .st.todo { color: #92400e; }
  td.oos div { margin: 1px 0; }
  #copied { color: #047857; font-size: 13px; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; background: #f3f4f6; padding: 6px 8px; border-bottom: 2px solid #d1d5db; font-weight: 600; white-space: nowrap; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
  tbody { page-break-inside: avoid; }
  tr.first td { border-top: 2px solid #9ca3af; }
  td.img img, .noimg { width: 72px; height: 72px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb; display: block; }
  .noimg { display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 12px; }
  td.code { font-size: 22px; font-weight: 700; white-space: nowrap; }
  .plat { font-size: 11px; font-weight: 400; color: #555; }
  .multi { font-size: 12px; color: #fff; background: #b45309; border-radius: 4px; padding: 1px 6px; display: inline-block; margin-top: 3px; font-weight: 600; }
  td.oid { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #374151; word-break: break-all; max-width: 130px; }
  td.sku { font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
  td.qty { font-size: 20px; font-weight: 700; text-align: center; }
  td.qty.many { color: #fff; background: #dc2626; border-radius: 4px; }
  td.title { max-width: 300px; }
  td.done, td.picked { white-space: nowrap; }
  .cb { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: #374151; margin: 4px 0; }
  .cb.bad { color: #b91c1c; }
  input[type=checkbox] { width: 20px; height: 20px; cursor: pointer; accent-color: #047857; margin: 0; }
  .cb.bad input { accent-color: #dc2626; }
  td.label { white-space: nowrap; font-size: 13px; }
  td.note { min-width: 150px; }
  td.note div { min-height: 48px; border-bottom: 1px dashed #9ca3af; outline: none; font-size: 13px; white-space: pre-wrap; }
  td.note div:empty::before { content: "点这里写备注（缺货、瑕疵等）"; color: #c0c4cc; }
  tr.picked-row td.title, tr.picked-row td.sku { color: #6b7280; text-decoration: line-through; }
  tr.oos-row td.title, tr.oos-row td.sku, tr.oos-row td.img, tr.oos-row td.qty, tr.oos-row td.picked { background: #fee2e2; }
  tbody.packed td { background: #f0fdf4; }
  tbody.issue td.done, tbody.issue td.code, tbody.issue td.oid, tbody.issue td.label, tbody.issue td.note { background: #fff7ed; }
  tbody.need-pkg td.done, tr.need-item td.picked { box-shadow: inset 0 0 0 3px #f59e0b; background: #fef9c3; }
  .muted { color: #9ca3af; font-weight: 400; }
  .warn { color: #dc2626; font-weight: 700; }
  @media print {
    body { margin: 8mm; }
    .bar, .tips .screen, #result .actions { display: none; }
    td.note div:empty::before { content: ""; }
    td.label a { color: #111; text-decoration: none; }
    a[href^="http"] { color: #1d4ed8; text-decoration: underline; }
    #result a[href^="http"]::after { content: "\\A" attr(href); white-space: pre-wrap; font-size: 8px; color: #1d4ed8; word-break: break-all; }
  }
</style></head><body>
  <h1>打包清单 · ${esc(dateLabel)}</h1>
  <div class="meta">共 ${packages} 个包裹、${units} 件商品<span class="progress" id="progress"></span></div>
  ${missing.length ? `<div class="alert">以下包裹还没有面单，先不要发：${missing.map(esc).join('、')}</div>` : ''}
  <div class="tips">
    每个编号是一个包裹（对应一张面单）。拣到一件勾「已拣货」，找不到勾「缺货」；整个包裹装好、贴好面单勾「已打包」，有别的问题勾「有问题」并在备注里写清楚。<br>
    <span class="screen">勾选和备注会自动保存在这台电脑上（关掉再打开还在）。「打开面单」要先把 zip <b>解压</b>，从解压出来的文件夹里打开本文件才能用。全部做完后点「完成，生成发货结果」，把结果表格复制或存成 PDF 发给老板。</span>
  </div>
  <div class="bar">
    <button class="go" id="btnResult">✅ 完成，生成发货结果</button>
    <button id="btnPrintBlank">🖨 打印清单（去找货用）</button>
  </div>
  <div id="result">
    <div id="resultBox"></div>
    <div class="actions">
      <button class="go" id="btnCopy">📋 复制表格</button>
      <button id="btnPrint">🖨 打印 / 存成 PDF</button><span id="copied"></span>
    </div>
  </div>
  <table>
    <thead><tr><th>已打包</th><th>编号</th><th>订单号</th><th>图片</th><th>商品名</th><th>SKU</th><th>数量</th><th>拣货</th><th>面单</th><th>备注</th></tr></thead>
    ${body}
  </table>
<script>
(function () {
  var KEY = 'packlist:${esc(sheetId || dateLabel)}';
  var TITLE = '${esc(String(dateLabel).slice(5).replace('-', '/'))}';
  var SHEET = '${esc(sheetId)}';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function $(s) { return document.querySelector(s); }
  function all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function refresh() {
    var packs = all('input[data-k^="pack:"]'), done = 0;
    packs.forEach(function (b) { if (b.checked) done++; b.closest('tbody').classList.toggle('packed', b.checked); });
    all('input[data-k^="issue:"]').forEach(function (b) { b.closest('tbody').classList.toggle('issue', b.checked); });
    all('input[data-k^="pick:"]').forEach(function (b) { b.closest('tr').classList.toggle('picked-row', b.checked); });
    all('input[data-k^="oos:"]').forEach(function (b) { b.closest('tr').classList.toggle('oos-row', b.checked); });
    $('#progress').textContent = '· 已打包 ' + done + ' / ' + packs.length;
    if ($('#result').classList.contains('show')) showResult();
  }
  all('input[data-k]').forEach(function (b) {
    b.checked = !!state[b.dataset.k];
    b.addEventListener('change', function () {
      // 「已拣货」和「缺货」只能选一个
      // 「已拣货 / 缺货」「已打包 / 有问题」各自只能选一个
      var PAIRS = { 'pick:': 'oos:', 'oos:': 'pick:', 'pack:': 'issue:', 'issue:': 'pack:' };
      var k = b.dataset.k, other = '';
      for (var pre in PAIRS) if (k.indexOf(pre) === 0) other = PAIRS[pre] + k.slice(pre.length);
      if (other && b.checked) { var o = document.querySelector('input[data-k="' + other + '"]'); if (o) { o.checked = false; state[other] = false; } }
      state[k] = b.checked; save();
      var tb = b.closest('tbody'); if (tb) { tb.classList.remove('need-pkg'); all('tr.need-item').forEach(function (tr) { if (tb.contains(tr)) tr.classList.remove('need-item'); }); }
      refresh();
    });
  });
  all('[contenteditable][data-k]').forEach(function (d) {
    d.textContent = state[d.dataset.k] || '';
    d.addEventListener('input', function () { state[d.dataset.k] = d.innerText.trim(); save(); refresh(); });
  });

  function collect() {
    return all('tbody[data-code]').map(function (tb) {
      var code = tb.dataset.code;
      var items = all('tbody[data-code="' + code + '"] tr').map(function (tr, i) {
        var p = JSON.parse(tr.dataset.item);
        return { sku: p.sku, qty: p.qty, title: p.title, oos: !!state['oos:' + code + ':' + (i + 1)] };
      });
      var g = { code: code, oid: tb.dataset.oid, url: tb.dataset.url, plat: tb.dataset.plat, noLabel: !!tb.dataset.nolabel,
        packed: !!state['pack:' + code], issue: !!state['issue:' + code], note: state['note:' + code] || '', items: items };
      g.oosItems = items.filter(function (it) { return it.oos; });
      g.status = g.issue ? '有问题' : g.packed ? '已打包' : g.noLabel ? '缺面单，未打包' : '未打包';
      return g;
    });
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var expanded = false; // 「已打包」明细默认折叠
  function resultHtml() {
    var gs = collect(), packed = gs.filter(function (g) { return g.packed; }).length;
    var oosN = gs.reduce(function (n, g) { return n + g.oosItems.length; }, 0), issueN = gs.filter(function (g) { return g.issue; }).length;
    // 需要处理的放上面：有问题 → 缺货 → 缺面单 → 未打包；全部正常打包的折叠成一行
    function rank(g) { return g.issue ? 0 : g.oosItems.length ? 1 : g.noLabel ? 2 : !g.packed ? 3 : 4; }
    var todo = gs.filter(function (g) { return rank(g) < 4; }).sort(function (a, b) { return rank(a) - rank(b); });
    var fine = gs.filter(function (g) { return rank(g) === 4; });
    var rows = todo.map(function (g) {
      var cls = g.issue || g.oosItems.length ? 'bad' : 'todo';
      var oos = g.oosItems.map(function (it) { return '<div>' + esc(it.title) + ' · <b>' + esc(it.sku) + '</b> × ' + esc(it.qty) + '</div>'; }).join('');
      return '<tr><td><b>' + esc(g.code) + '</b><div class="plat">' + esc(g.plat) + '</div></td>'
        + '<td>' + (g.url ? '<a href="' + esc(g.url) + '">' + esc(g.oid) + '</a>' : esc(g.oid || '—')) + '</td>'
        + '<td class="st ' + cls + '">' + esc(g.status) + '</td>'
        + '<td class="oos">' + oos + '</td>'
        + '<td>' + esc(g.note) + '</td></tr>';
    }).join('');
    if (fine.length) {
      var list = fine.map(function (g) { return esc(g.code) + (g.note ? '（' + esc(g.note) + '）' : ''); }).join('、');
      rows += '<tr class="fine"><td colspan="2"><b>✓ 已打包 ' + fine.length + ' 个</b>'
        + (expanded ? ' <a href="#" class="toggle" data-act="collapse">收起明细</a>' : ' <a href="#" class="toggle" data-act="expand">展开明细</a>')
        + '</td><td class="st ok">已打包</td><td colspan="2">' + list + '</td></tr>';
      if (expanded) {
        rows += fine.map(function (g) {
          return '<tr class="fine-item"><td><b>' + esc(g.code) + '</b><div class="plat">' + esc(g.plat) + '</div></td>'
            + '<td>' + (g.url ? '<a href="' + esc(g.url) + '">' + esc(g.oid) + '</a>' : esc(g.oid || '—')) + '</td>'
            + '<td class="st ok">已打包</td><td></td><td>' + esc(g.note) + '</td></tr>';
        }).join('');
      }
    }
    return '<h2>发货结果 · ' + esc(TITLE) + '</h2>'
      + '<div class="sum">已打包 <b>' + packed + ' / ' + gs.length + '</b> 个包裹' + (oosN ? ' · <span class="warn">缺货 ' + oosN + ' 件</span>' : '') + (issueN ? ' · <span class="warn">有问题 ' + issueN + ' 个</span>' : '') + (SHEET ? ' · <span class="muted">' + esc(SHEET) + '</span>' : '') + '</div>'
      + '<table><thead><tr><th>编号</th><th>订单号（点开看订单）</th><th>状态</th><th>缺货（商品名 · SKU × 数量）</th><th>备注</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function resultText() {
    var L = [['编号', '平台', '订单号', '订单链接', '状态', '缺货', '备注'].join('\\t')];
    var gs = collect();
    function rank(g) { return g.issue ? 0 : g.oosItems.length ? 1 : g.noLabel ? 2 : !g.packed ? 3 : 4; }
    gs.sort(function (a, b) { return rank(a) - rank(b); }).forEach(function (g) {
      L.push([g.code, g.plat, g.oid, g.url, g.status, g.oosItems.map(function (it) { return it.title + ' · ' + it.sku + ' × ' + it.qty; }).join('；'), g.note.replace(/\\s+/g, ' ')].join('\\t'));
    });
    return '发货结果 · ' + TITLE + '\\n' + L.join('\\n');
  }
  function showResult() { $('#resultBox').innerHTML = resultHtml(); }
  $('#resultBox').addEventListener('click', function (e) {
    var t = e.target.closest('a.toggle');
    if (!t) return;
    e.preventDefault(); expanded = t.dataset.act === 'expand'; showResult();
  });
  // 每个有面单的包裹：要勾「已打包」或「有问题」；里面每件商品：要勾「已拣货」或「缺货」
  function findMissing() {
    var miss = [];
    all('tbody[data-code]').forEach(function (tb) {
      tb.classList.remove('need-pkg');
      all('tbody[data-code="' + tb.dataset.code + '"] tr').forEach(function (tr) { tr.classList.remove('need-item'); });
      if (tb.dataset.nolabel) return; // 缺面单的包裹本来就不能打包，不用勾
      var code = tb.dataset.code, what = [];
      if (!state['pack:' + code] && !state['issue:' + code]) { what.push('「已打包 / 有问题」'); tb.classList.add('need-pkg'); }
      all('tbody[data-code="' + code + '"] tr').forEach(function (tr, i) {
        if (!state['pick:' + code + ':' + (i + 1)] && !state['oos:' + code + ':' + (i + 1)]) { tr.classList.add('need-item'); what.push('第 ' + (i + 1) + ' 件的「已拣货 / 缺货」'); }
      });
      if (what.length) miss.push(code + '：' + what.join('、'));
    });
    return miss;
  }
  $('#btnResult').addEventListener('click', function () {
    var miss = findMissing();
    if (miss.length) {
      alert('还有 ' + miss.length + ' 个包裹没勾完，不能生成发货结果：\\n\\n' + miss.join('\\n') + '\\n\\n没勾的地方已经用黄色框标出来了。');
      var first = document.querySelector('tbody.need-pkg, tr.need-item');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    $('#result').classList.add('show'); showResult();
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#btnCopy').addEventListener('click', function () {
    // 同时复制成表格（粘贴到邮件 / Google Sheets 里还是表格）和纯文字（Tab 分隔）
    var html = '<meta charset="utf-8">' + resultHtml().replace(/ ?<a href="#" class="toggle"[^>]*>[^<]*<\\/a>/g, ''), text = resultText();
    function ok() { $('#copied').textContent = ' 已复制，粘贴到邮件或表格里就是一张表'; setTimeout(function () { $('#copied').textContent = ''; }, 4000); }
    function fallback() {
      var div = document.createElement('div'); div.innerHTML = resultHtml(); div.style.position = 'fixed'; div.style.left = '-9999px'; document.body.appendChild(div);
      var r = document.createRange(); r.selectNodeContents(div); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand('copy'); ok(); } catch (e) {} sel.removeAllRanges(); div.remove();
    }
    try {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(ok, fallback);
    } catch (e) { fallback(); }
  });
  $('#btnPrint').addEventListener('click', function () { if (findMissing().length) { $('#btnResult').click(); return; } $('#result').classList.add('show'); showResult(); window.print(); });
  $('#btnPrintBlank').addEventListener('click', function () { $('#result').classList.remove('show'); window.print(); });
  refresh();
})();
</script>
</body></html>`;
}

export function buildCsv(rows) {
  const head = ['编号', '平台', '商品名', 'SKU', '数量', '订单号', '面单文件', '同包第几件', '已拣货', '已打包', '备注'];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head, ...rows.map((r) => [
    r.code, PLATFORM_META[r.platform].name, r.title, r.sku, r.qty, r.orderId,
    r.labelFile.replace('面单/', ''), `第${r.itemIndex}件/共${r.itemCount}件`, '', '', '',
  ])].map((l) => l.map(cell).join(','));
  return '﻿' + lines.join('\r\n'); // BOM：Excel 打开中文不乱码
}

/**
 * 运行报告。前三行是机器可读摘要（STATUS / SUMMARY / ZIP），后面是给人看的说明。
 * STATUS：OK 一切正常；WARN 有需要你处理的问题；EMPTY 没有新订单。
 */
export function buildRunReport({ trigger, startedAt, finishedAt, platforms = {}, loginIssues = [], failures = [],
  labelFailures = [], warnings = [], samples = [], rows = [], zipName = '', sendTo = [], sendFrom = '' }) {
  const name = (p) => (PLATFORM_META[p] || PLATFORM_META.other).name;
  const packages = new Set(rows.map((r) => r.code)).size;
  const units = rows.reduce((s, r) => s + r.qty, 0);
  const missing = [...new Set(rows.filter((r) => !r.labelFile).map((r) => r.code))];
  const problems = missing.length + loginIssues.length + failures.length + warnings.length;
  const status = problems ? 'WARN' : rows.length ? 'OK' : 'EMPTY';

  const parts = [rows.length ? `${packages} 个包裹 ${units} 件` : '没有新的待发货订单'];
  if (missing.length) parts.push(`${missing.length} 个缺面单`);
  if (loginIssues.length) parts.push(`${loginIssues.map(name).join('、')} 需要重新登录`);
  if (failures.length) parts.push(`${failures.length} 条读取失败`);
  if (warnings.length) parts.push(`${warnings.length} 条需核对`);
  const summary = parts.join('，');

  const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  const lines = [
    `STATUS: ${status}`,
    `SUMMARY: ${summary}`,
    `ZIP: ${zipName}`,
    ...(sendTo.length ? [`SEND_TO: ${sendTo.join(', ')}`] : []),
    ...(sendTo.length && sendFrom ? [`SEND_FROM: ${sendFrom}`] : []),
    '',
    '发货助手 · 运行报告',
    '====================',
    `触发方式：${trigger}`,
    `开始时间：${fmt(startedAt)}    结束时间：${fmt(finishedAt)}`,
    `结果：${summary}`,
    zipName ? `发货：${zipName}` : '本次没有生成发货文件。',
  ];
  const plats = Object.entries(platforms);
  if (plats.length) {
    lines.push('', '各平台：');
    for (const [p, s] of plats) {
      lines.push(`  ${name(p)}：列表中 ${s.found} 单，新加入 ${s.added}，已寄出跳过 ${s.shipped || 0}，之前打包过 ${s.skipped}（默认不勾选），失败 ${s.failed}`);
    }
  }
  if (rows.length) {
    lines.push('', '包裹清单：');
    let last = '';
    for (const r of rows) {
      const head = r.code !== last ? `  ${r.code}  ${name(r.platform)}  订单 ${r.orderId || '—'}  ${r.labelFile ? '有面单' : '【缺面单】'}` : '';
      if (head) lines.push(head);
      lines.push(`        × ${r.qty}  ${r.sku ? `[${r.sku}] ` : ''}${r.title}`);
      last = r.code;
    }
  }
  if (loginIssues.length) {
    lines.push('', '需要你处理 —— 登录失效：', ...loginIssues.map((p) => `  ${name(p)}：请在 Chrome 里重新登录，然后再运行一次。`));
  }
  // 正文只放一行原因；带【诊断】的完整内容放到最后的调试区（发邮件时会去掉调试区）
  const short = (t) => String(t).split('\n')[0];
  if (missing.length || labelFailures.length) {
    lines.push('', '需要你处理 —— 缺面单（这些包裹先不要发）：');
    if (missing.length) lines.push(`  ${missing.join('、')}`);
    if (labelFailures.length) lines.push('  原因：', ...labelFailures.map((s) => `    ${short(s)}`));
    lines.push('  补救：在平台下载面单后打开扩展批次页，把 PDF 拖到对应行，再点「打包下载」。');
  }
  if (warnings.length) {
    lines.push('', '请核对：', ...warnings.map((w) => `  ${short(w)}`));
  }
  if (failures.length) {
    lines.push('', '读取失败（这些订单没有进入发货）：', ...failures.map((f) => `  ${short(f)}`));
  }
  const debug = [...failures, ...labelFailures, ...warnings].filter((t) => /\n/.test(String(t)));
  if (debug.length || samples.length) {
    lines.push('', '----- 以下为调试信息（发给开发者用，邮件里不会包含） -----');
    if (debug.length) lines.push('', '详细诊断：', ...debug.map((t) => `  ${t}`));
    if (samples.length) lines.push('', '页面样本（每个平台第一单读到了什么）：', ...samples.map((t) => `  ${t}`));
  }
  return { status, summary, text: lines.join('\n') + '\n' };
}

export const README_TXT = `发货使用说明（给打包同事）
================================

先把附件 zip 解压，再打开解压出来的文件夹（直接在压缩包里打开，面单链接会打不开）。

文件说明
- 打印-面单带对照卡.pdf   ← 推荐打印这个。每个包裹两张：先是一张「对照卡」（大号编号 + SKU + 数量 + 商品名），紧接着就是这个包裹的面单。
- 打包清单.html ← 用浏览器打开：每个编号一个包裹，有商品图片；可以勾「已拣货」「已打包」、写备注，点「打开面单」直接看这个包裹的面单。
- 打包清单.csv  ← 同样的内容，表格格式（Excel / Google Sheets 打开），没有图片。
- 面单/          ← 每个包裹单独一个文件，文件名开头就是编号（需要单独重打某一张时用）。
  P = Poshmark，M = Mercari，D = Depop

打包步骤
1. 打印「打印-面单带对照卡.pdf」，不要打乱顺序。
2. 打开「打包清单.html」，按编号一个包裹一个包裹来：照图片 / SKU / 数量拣货，拣到一件勾一个「已拣货」。
3. 这个包裹的货拣齐后装箱，贴上对应编号的面单（对照卡后面紧跟的那张），勾「已打包」。
   有问题写在「备注」里（勾选和备注会自动保存在这台电脑上）。
4. 标着「缺面单」的包裹先不要发，通知老板。
5. 有疑问（找不到货、数量不够、商品有瑕疵）先拍照发给老板，不要自己替换商品。
`;
