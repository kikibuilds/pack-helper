// eBay：Seller Hub 的读取规则（一键拉取用）。
//
// eBay 的特点：卖家可以在 eBay 上买面单，也可以自己在别处买面单、再把运单号填回 eBay。
//   · 在 eBay 上买的面单：会出现在 Seller Hub →「Shipping labels」（/ship/labels/seller-hub）里，可以重新打印 / 下载。
//   · 自己填运单号的（第三方面单）：eBay 上只有运单号，没有面单文件，拉不到。
// 买了面单以后，订单状态就变成「Shipped · Label created」（还没被快递扫描），不再在「Awaiting shipment」里。
// 所以拉取时读「All orders」列表：
//   Awaiting shipment            → 还没买面单：加进批次，标「缺面单」（扩展不会替你买）
//   Shipped · Label created      → 在「Shipping labels」里有 → 下载面单；没有 → 第三方面单，标「缺面单」
//   Carrier scan / In transit / Delivered / Canceled … → 已寄出，跳过
//
// 前面几个函数会被注入到 eBay 页面里运行（chrome.scripting.executeScript），必须自包含。
// 不读取买家姓名、地址。

/** 订单列表（/sh/ord/）：每单一行。返回 [{ orderId, statusText, tracking, url }] */
export function ebayOrderRows() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const ID = /\b(\d{2}-\d{5}-\d{5})\b/;
  const out = [];
  const seen = new Set();
  const rows = [...document.querySelectorAll('tr[class*="orderid_"], tr.order-info')];
  for (const tr of rows) {
    const id = ((tr.className.match(/orderid_(\d{2}-\d{5}-\d{5})/) || [])[1])
      || [...tr.querySelectorAll('a[href*="orderid"]')].map((a) => { try { return new URL(a.href).searchParams.get('orderid') || ''; } catch { return ''; } }).find((x) => ID.test(x))
      || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // 状态格：「Shipped Label created Oct 27」「Awaiting shipment Ship by Oct 30」「Delivered Oct 20」
    const st = [...tr.querySelectorAll('[class*="status" i], [class*="shipping" i], [class*="fulfil" i]')]
      .map((e) => clean(e.innerText)).filter((t) => t && t.length <= 120)
      .find((t) => /awaiting|ship by|shipped|label|scan|transit|deliver|cancel|refund|return|paid/i.test(t)) || '';
    const text = clean(tr.innerText);
    // 运单号：先找连在一起的；页面上按 4 位一组显示的，再把组间空格去掉找
    const TRK = /\b(9[2-5]\d{18,24}|1Z[0-9A-Z]{16})\b/;
    const tm = text.match(TRK) || text.replace(/\b(\d{4}) (?=\d{2,4}\b)/g, '$1').match(TRK);
    out.push({
      orderId: id,
      statusText: st || (text.match(/(awaiting shipment|ship by [a-z]{3} \d{1,2}|label created|label printed|carrier scan|in transit|delivered|cancell?ed|refunded|shipped)/i) || [])[0] || '',
      tracking: tm ? tm[1] : '',
      url: `${location.origin}/mesh/ord/details?orderid=${id}`,
    });
  }
  return out;
}

/** 「Shipping labels」页（在 eBay 上买的面单记录）：返回 [{ orderId, track }] */
export function ebayLabelRows() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const ID = /\b(\d{2}-\d{5}-\d{5})\b/;
  const out = [];
  for (const tr of document.querySelectorAll('tbody tr, [role="row"]')) {
    const a = [...tr.querySelectorAll('a')].find((x) => ID.test(clean(x.innerText)));
    if (!a) continue;
    const cells = [...tr.children].map((c) => clean(c.innerText));
    out.push({ orderId: clean(a.innerText).match(ID)[1], track: (cells[cells.length - 1] || '').slice(0, 60) });
  }
  return out;
}

/**
 * 「Shipping labels」页上，某个订单那一行的「Actions」菜单里找重新打印 / 下载面单。
 * mode='find' 只找（返回链接）；mode='click' 点击。
 * 安全：「Get another label」（再买一张）、「Cancel label」、带 buy / purchase / $ 的一律不点。
 */
export async function ebayLabelAction(mode, orderId) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const BAD = /another|cancel|void|refund|buy|purchase|pay\b|upgrade|edit|change|packing slip|coupon|\$/i;
  const GOOD = /^(re-?)?print( the)?( shipping)? label$|^(download|view|open|show)( the)?( shipping)? label( pdf)?$|^(re-?)?print$|^download( pdf)?$/i;
  const tr = [...document.querySelectorAll('tbody tr, [role="row"]')].find((r) => [...r.querySelectorAll('a')].some((a) => clean(a.innerText) === orderId));
  if (!tr) return { found: false, why: `「Shipping labels」里没有订单 ${orderId}` };
  const label = (el) => clean(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title'));
  const pick = (root) => {
    const els = [...root.querySelectorAll('a, button, [role="menuitem"]')].filter((el) => visible(el) && GOOD.test(label(el)) && !BAD.test(label(el)));
    return els.filter((el) => !els.some((o) => o !== el && el.contains(o)))[0] || null;
  };
  // 有的直接在行里，有的在「Actions」下拉菜单里（打开菜单不会改任何东西）
  let el = pick(tr);
  let opened = null;
  if (!el) {
    opened = [...tr.querySelectorAll('button')].find((b) => /^actions$/i.test(label(b)) || b.getAttribute('aria-haspopup'));
    if (opened) {
      opened.click();
      await new Promise((r) => setTimeout(r, 700));
      el = pick(tr) || pick(document.body.querySelector('[role="menu"]:not([hidden])') || tr);
    }
  }
  const close = () => { if (opened && opened.getAttribute('aria-expanded') === 'true') opened.click(); };
  if (!el) {
    // eBay 的菜单是行里的 a.fake-menu__item（Get another label / Cancel label / Print packing slip）
    const items = opened ? [...new Set([...tr.querySelectorAll('.fake-menu__item, [role="menuitem"]'), ...document.querySelectorAll('[role="menu"] a, [role="menu"] button')]
      .filter(visible).map(label).filter(Boolean))] : [];
    close();
    return { found: false, why: `订单 ${orderId} 的「Actions」菜单里没有「Reprint / Print / Download label」${items.length ? `（菜单里只有：${items.join('、')}）` : ''}` };
  }
  const href = el.tagName === 'A' && /^https?:/.test(el.href) && !/#$/.test(el.href) ? el.href : '';
  const text = label(el);
  if (mode !== 'click') { close(); return href ? { found: true, href, text } : { found: true, text }; }
  el.click();
  return { found: true, clicked: true, text };
}

/** 列表上的状态 → 'awaiting'（还没买面单）/ 'label'（已有面单、还没寄出）/ 'shipped'（已寄出或取消，跳过） */
export function ebayKind(statusText) {
  const t = String(statusText || '');
  if (/carrier scan|in transit|out for delivery|delivered|cancel|refund|return|accepted|picked up|arriving/i.test(t)) return 'shipped';
  if (/label created|label printed|label purchased|pre-?shipment/i.test(t)) return 'label';
  if (/awaiting shipment|ship by|not yet shipped|ready to ship/i.test(t)) return 'awaiting';
  return 'shipped';
}

export const EBAY_LABELS_URL = 'https://www.ebay.com/ship/labels/seller-hub';
export const EBAY_ONLY_NOTE = '仅限在 eBay 平台购买的面单支持拉取（必须先在 eBay 上买好面单；自己填运单号的第三方面单拉不到）';

/**
 * 面单页（/ship/single/print/…）：上面有「Print label」「Download label」两个按钮。
 * 只点「Download label」（下载 PDF）；「Print label」会弹出打印对话框，Cancel / Get another label 等一律不点。
 */
export function ebayPrintPageAction(mode) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const label = (el) => clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title'));
  const BAD = /another|cancel|void|refund|buy|purchase|pay\b|upgrade|edit|change|packing slip|\$/i;
  const els = [...document.querySelectorAll('button, a, [role="button"]')]
    .filter((el) => visible(el) && /^download( shipping)? label( pdf)?$/i.test(label(el)) && !BAD.test(label(el)) && el.getAttribute('aria-disabled') !== 'true');
  const el = els.filter((e) => !els.some((o) => o !== e && e.contains(o)))[0];
  if (!el) return { found: false };
  const href = el.tagName === 'A' && /^https?:/.test(el.href) && !/#$/.test(el.href) ? el.href : '';
  if (mode !== 'click') return href ? { found: true, href, text: label(el) } : { found: true, text: label(el) };
  el.click();
  return { found: true, clicked: true, text: label(el) };
}

export const isEbayPrintPage = (url) => /ebay\.[a-z.]+\/ship\/single\/print\//i.test(String(url || ''));
