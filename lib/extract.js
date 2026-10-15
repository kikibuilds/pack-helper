// 这两个函数会被注入到平台页面里运行（chrome.scripting.executeScript），
// 所以必须完全自包含：不能引用本文件以外的任何变量。

/** 从当前订单详情页读取：订单号、商品名、图片、SKU、数量、运单号后 4 位。不读取买家信息。 */
export function extractOrderFromPage() {
  const host = location.hostname;
  const platform = host.includes('ebay') ? 'ebay'
    : host.includes('poshmark') ? 'poshmark'
    : host.includes('mercari') ? 'mercari'
    : host.includes('depop') ? 'depop' : 'other';

  const text = document.body ? document.body.innerText : '';
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };

  // 订单号：优先从网址取，其次从页面文字取
  let orderId = '';
  const path = location.pathname;
  const urlPatterns = [
    /[?&]orderid=([\w-]+)/i,                                  // eBay
    /\/order\/sales\/([a-z0-9]{8,})/i,                        // Poshmark
    /\/transaction\/(?:[a-z_]+\/)*([a-z]?\d{6,}[a-z0-9]*)/i,  // Mercari: /transaction/order_status/m123…
    /\/sold-items\/([\w-]{6,})/i,                             // Depop
    /\/receipts?\/([\w-]{6,})/i,
    /\/orders?\/([\w-]{6,})/i,
  ];
  for (const re of urlPatterns) {
    const m = (path + location.search).match(re);
    if (m) { orderId = m[1]; break; }
  }
  if (!orderId) orderId = pick(/Order\s*(?:#|ID|number|No\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);

  // 网站导航、页头页尾里的链接（Sell now、My listings…）一律不算商品
  // 也排除 Cookie / 隐私弹窗（Mercari 上读成了「Privacy settings」）
  const inChrome = (el) => !!el.closest('header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [aria-modal="true"], [class*="header" i], [class*="navbar" i], [class*="nav-bar" i], [class*="footer" i], [class*="sidebar" i], [id*="onetrust" i], [class*="onetrust" i], [id*="cookie" i], [class*="cookie" i], [class*="consent" i], [id*="consent" i]');
  const GENERIC = /^(sell( now)?|my (listings|closet|shop|account|orders|sales|purchases)|shop|home|explore|messages|notifications|likes|profile|settings|help|log ?out|sign ?in|view (item|listing)|see (item|listing)|listing|item|(product|item|listing) (image|photo|picture)s?|image|photo|picture|thumbnail|(privacy|cookie|consent)( settings| preferences| policy)?|manage (cookies|preferences)|accept( all)?( cookies)?|reject all|.{0,3})$/i;
  const SITE_TITLE = /^(poshmark|mercari|depop|ebay)\b|[|-]\s*(poshmark|mercari|depop|ebay)\s*$|^(my )?(sales|orders|sold items|order details?|order status|order summary|shipping information|buyer information|item id|in transit|delivered|send this order|ship the item|ship your item|confirm as sent|print (the )?label|open label)$/i;
  const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const okTitle = (t) => t.length >= 6 && t.length <= 200 && !GENERIC.test(t) && !SITE_TITLE.test(t);
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const badImg = (img) => /logo|avatar|profile|icon|sprite|badge|member|user|seller|shop-?img|banner|emoji/i.test(`${img.currentSrc || img.src} ${img.alt} ${img.className}`);

  const listingRe = /\/(itm|listing|listings|item|items|products)\/|\/us\/item\//i;
  const notListingRe = /\/(create|new|sell|edit|drafts?)\b|\/listings\/?(\?|$)|\/mypage\//i;
  let title = '';
  let imageUrl = '';
  let itemImg = null;
  let itemUrl = '';

  // Mercari 订单页：商品在右侧「Order summary」里（在侧栏里，下面的通用规则会把侧栏排除掉），
  // 商品名是 /us/item/m… 链接的文字，左边的图是同一个链接里的图片
  if (platform === 'mercari') {
    const links = [...document.querySelectorAll('a[href]')]
      .filter((a) => /\/item\/m?\d{6,}/i.test(a.getAttribute('href') || '') && visible(a));
    if (links[0]) itemUrl = links[0].href;
    const texts = links.map((a) => clean(a.innerText)).filter(okTitle).sort((a, b) => b.length - a.length);
    if (texts[0]) title = texts[0];
    if (!title) {
      const lines = text.split('\n').map(clean).filter(Boolean);
      const i = lines.findIndex((l) => /^order summary$/i.test(l));
      if (i >= 0 && okTitle(lines[i + 1] || '')) title = lines[i + 1];
    }
    const itemId = ((itemUrl.match(/\/item\/(m?\d{6,})/i) || [])[1]) || orderId;
    const srcOf = (img) => img.currentSrc || img.src || '';
    for (const a of links) {
      const img = [...a.querySelectorAll('img')].find((im) => !/\/members\//i.test(srcOf(im)));
      if (img) { itemImg = img; break; }
    }
    if (!itemImg && itemId) itemImg = [...document.images].find((im) => srcOf(im).includes(itemId)) || null;
    if (!itemImg) {
      // 图片是 CSS 背景图的情况
      outer: for (const a of links) {
        for (const el of [a, ...a.querySelectorAll('*')]) {
          const m = (getComputedStyle(el).backgroundImage || '').match(/url\(["']?(https?:[^"')]+)/);
          if (m && !/\/members\//i.test(m[1])) { imageUrl = m[1]; break outer; }
        }
      }
    }
  }
  const anchors = [...document.querySelectorAll('a[href]')].filter((a) => {
    const href = a.getAttribute('href') || '';
    return listingRe.test(href) && !notListingRe.test(href) && visible(a) && !inChrome(a);
  });
  for (const a of anchors) {
    const t = clean(a.innerText || a.getAttribute('title') || a.getAttribute('aria-label'));
    const img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img'));
    if (!title && okTitle(t)) title = t;
    if (!itemImg && img && !badImg(img)) itemImg = img;
    if (title && itemImg) break;
  }
  if (!itemImg && !imageUrl && platform !== 'mercari') {
    // 页面主体里面积最大的一张图（排除头像、logo 和导航里的图）
    let bestArea = 0;
    for (const img of document.images) {
      if (inChrome(img) || badImg(img)) continue;
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width >= 60 && r.height >= 60) { itemImg = img; bestArea = area; }
    }
  }
  if (itemImg) imageUrl = itemImg.currentSrc || itemImg.src;
  if (!title && itemImg && okTitle(clean(itemImg.alt))) title = clean(itemImg.alt); // Depop 等没有标题的平台
  if (!title && itemImg) {
    // 商品图旁边的文字（Poshmark 订单页的商品名不是链接）：从图片往上找几层，取第一行像商品名的文字
    const NOT_TITLE = /^(\$|us\$|size\b|sz\b|qty|quantity|order|sold|price|total|subtotal|earnings?|shipping|tax|fee|discount|offer|listing price|nwt$|nwot$|new$|brand\b|color\b|condition|date|status|buyer|seller|@)|^\d[\d\s/.,:-]*$/i;
    let node = itemImg.parentElement;
    for (let lvl = 0; lvl < 5 && node && !title; lvl++, node = node.parentElement) {
      if (inChrome(node)) break;
      const lines = (node.innerText || '').split('\n').map(clean).filter(Boolean);
      if (lines.length > 25) break; // 已经到了整页级别，停止
      title = lines.find((l) => okTitle(l) && l.length >= 8 && !NOT_TITLE.test(l)) || '';
    }
  }
  if (!title && platform !== 'mercari') {
    const og = document.querySelector('meta[property="og:title"]');
    const cands = [og && og.content, ...[...document.querySelectorAll('main h1, main h2, h1, h2')].filter((h) => visible(h) && !inChrome(h)).map((h) => h.innerText)];
    title = cands.map(clean).find(okTitle) || '';
  }

  // 订单状态：标题或状态标签显示已寄出 / 运输中 / 已送达的，属于已发货订单，不应再打包
  //（Mercari：「Awaiting rating from buyer」= 已寄出，等买家评价）
  const SHIPPED = /^(in transit|delivered|shipped|out for delivery|on (its|the) way|completed|order completed?|sale completed?|item delivered|awaiting (buyer'?s? )?rating( from (the )?buyer)?|waiting for (the )?buyer('?s)? (rating|review)|rate (the )?buyer)\.?$/i;
  const statusEls = [...document.querySelectorAll('h1, h2, h3, h4, [role="heading"], [class*="status" i]')]
    .filter((el) => visible(el) && !inChrome(el));
  const shippedStatus = statusEls.map((el) => clean(el.innerText)).find((t) => t.length <= 40 && SHIPPED.test(t)) || '';

  // —— 一个订单多件商品（Poshmark bundle 等）：每个「SKU:」各算一件 ——
  const SKU_LINE = /^(?:custom\s*label\s*\(sku\)|custom\s*label|sku)\s*[:#]?\s*([A-Za-z0-9][\w.\-\/]{1,40})$/i;
  const NOT_TITLE2 = /^(\$|us\$|size\b|sz\b|qty|quantity|order|sold|price|total|subtotal|earnings?|shipping|tax|fee|discount|offer|brand\b|color\b|condition|date|status|buyer|seller|view bundle|@)|^\d[\d\s/.,:-]*$/i;
  const skuNodes = [];
  {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const el = w.currentNode.parentElement;
      if (el && SKU_LINE.test(clean(w.currentNode.textContent)) && visible(el) && !inChrome(el)) skuNodes.push(el);
    }
  }
  let items = [];
  if (skuNodes.length >= 2) {
    items = skuNodes.map((el) => {
      // 往上找到只包含这一个 SKU 的最大区块 = 这件商品
      let box = el;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (skuNodes.some((o) => o !== el && n.contains(o))) break;
        box = n;
      }
      const lines = (box.innerText || '').split('\n').map(clean).filter(Boolean);
      const m = clean(el.textContent).match(SKU_LINE);
      const img = box.querySelector('img');
      return {
        title: lines.find((l) => okTitle(l) && l.length >= 8 && !NOT_TITLE2.test(l) && !SKU_LINE.test(l)) || '',
        sku: m ? m[1] : '',
        imageUrl: img && /^https?:/.test(img.currentSrc || img.src) ? (img.currentSrc || img.src) : '',
        qty: 1,
      };
    });
  }
  const isBundle = /\bview bundle\b|\bbundle\b/i.test(text);

  // SKU：页面上的「SKU: xxx」；没有的话取商品名里方括号中的编号，例如「… Romper [MXM-27]」
  const bracket = (t) => { const all = [...String(t || '').matchAll(/\[([A-Za-z0-9][\w.\-\/]{1,40})\]/g)]; return all.length ? all[all.length - 1][1] : ''; };
  for (const it of items) if (!it.sku) it.sku = bracket(it.title);
  const sku = pick(/(?:Custom\s*label\s*\(SKU\)|Custom\s*label|SKU)\s*[:#]?\s*\n?\s*([A-Za-z0-9][\w.\-\/]{1,40})/i) || bracket(title);
  const qty = parseInt(pick(/(?:Qty|Quantity)\s*[:x×]?\s*\n?\s*(\d{1,3})\b/i), 10) || 1;

  // 运单号（USPS / UPS），页面上可能带空格分组
  const compact = text.replace(/(\d)[  ]+(?=\d)/g, '$1');
  const tm = compact.match(/\b(9[2-5]\d{18,24}|1Z[0-9A-Z]{16})\b/);
  const trackingLast4 = tm ? tm[1].slice(-4) : '';

  return {
    platform,
    url: location.href,
    orderId,
    title: title.trim().slice(0, 200),
    itemUrl,
    imageUrl: imageUrl && /^https?:/.test(imageUrl) ? imageUrl : '',
    shippedStatus,
    items,
    isBundle,
    sku,
    qty,
    trackingLast4,
  };
}

/**
 * 在订单详情页找「打印/下载面单」。mode='find' 只返回链接；mode='click' 点击按钮。
 * 安全规则：带有 buy / purchase / pay / confirm / $ 等字样的按钮一律不点，绝不会替你花钱买面单。
 */
export function findLabelOnPage(mode) {
  // 「Upgrade Shipping Label」要额外付钱，绝不点
  const bad = /buy|purchase|pay\b|payment|confirm|checkout|cost|\$|cancel|refund|return|void|upgrade|change|edit|new label|qr/i;
  const good = /(re-?)?print(ing)?\s*(the\s*)?(shipping\s*|prepaid\s*)?label|(download|get|view|open|show)\s*(the\s*)?(shipping\s*|prepaid\s*)?label|^(shipping|prepaid)\s*label$|^label$/i;
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
  const all = [...document.querySelectorAll('a, button, [role="button"]')].filter(visible);
  let els = all.filter((el) => { const t = txt(el); return t && t.length <= 40 && good.test(t) && !bad.test(t); });
  if (!els.length) {
    // Poshmark：「Shipping Label」那一栏里只写着「Download」/「Print」
    const sectionHasLabel = (el) => {
      let node = el.parentElement;
      for (let lvl = 0; lvl < 4 && node; lvl++, node = node.parentElement) {
        const t = (node.innerText || '').replace(/\s+/g, ' ');
        if (t.length > 400) return false; // 已经到了大区块，不算同一栏
        if (/shipping label|prepaid label/i.test(t)) return true;
      }
      return false;
    };
    els = all.filter((el) => /^(download|print|view|open)( pdf)?$/i.test(txt(el)) && sectionHasLabel(el));
    if (!els.length) {
      // 有的网站「Download」只是一段可点击的文字（div / span），不是按钮
      const loose = [...document.querySelectorAll('span, div, p, label, strong, b, i, u, li, td')]
        .filter((el) => visible(el) && /^(download|print)( pdf| label)?$/i.test(txt(el)) && sectionHasLabel(el));
      // 取最内层的那个（文字一样时，子元素比父元素更精确）
      els = loose.filter((el) => !loose.some((o) => o !== el && el.contains(o)));
    }
  }
  if (!els.length) return { found: false };
  const a = els.find((e) => e.tagName === 'A' && /^https?:/.test(e.href) && !/#$/.test(e.href));
  // 只查找时绝不点击（之前这里会提前点一次，导致每单下载两遍）
  if (mode !== 'click') return a ? { found: true, href: a.href, text: a.innerText.trim() } : { found: true, text: (els[0].innerText || '').trim() };
  const target = a || els[0].closest('a, button, [role="button"]') || els[0];
  target.click();
  return { found: true, clicked: true, text: (target.innerText || els[0].innerText || '').trim() };
}

/**
 * 页面诊断：只收集页面结构（链接路径和文字、标题、按钮、图片、带关键词的文字行），
 * 用来调整读取规则。不收集地址块；复制前你可以先看一遍内容。
 */
export function diagnosePage() {
  const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const where = (el) => (el.closest('header, nav, footer, aside, [role="navigation"], [role="banner"]') ? 'nav' : 'main');
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const shortPath = (href) => { try { const u = new URL(href, location.href); return u.pathname + (u.search ? '?' + [...u.searchParams.keys()].join('&') : ''); } catch { return ''; } };

  const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 120)
    .map((a) => `${where(a)} | ${shortPath(a.getAttribute('href'))} | ${clean(a.innerText || a.getAttribute('aria-label'))} | img:${a.querySelector('img') ? 'Y' : 'N'}`);
  const heads = [...document.querySelectorAll('h1,h2,h3')].filter(visible).slice(0, 30).map((h) => `${h.tagName} ${where(h)} | ${clean(h.innerText)}`);
  const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible).slice(0, 60)
    .map((b) => `${where(b)} | ${clean(b.innerText || b.getAttribute('aria-label'))}`).filter((s) => !/\|\s*$/.test(s));
  const imgs = [...document.images].filter(visible).map((img) => {
    const r = img.getBoundingClientRect();
    let src = '';
    try { const u = new URL(img.currentSrc || img.src); src = u.hostname + u.pathname.slice(0, 70); } catch { /* data: 等 */ }
    return { area: Math.round(r.width * r.height), line: `${where(img)} | ${Math.round(r.width)}x${Math.round(r.height)} | ${src} | alt=${clean(img.alt)} | class=${clean(img.className).slice(0, 40)}` };
  }).sort((a, b) => b.area - a.area).slice(0, 15).map((x) => x.line);
  const KEY = /sku|custom label|qty|quantity|order|item|title|label|tracking|ship|size|style|brand|description|status/i;
  const lines = (document.body.innerText || '').split('\n').map(clean).filter((l) => l && l.length <= 100 && KEY.test(l)).slice(0, 60);

  return [
    `URL: ${location.hostname}${location.pathname}`,
    `og:title: ${clean((document.querySelector('meta[property="og:title"]') || {}).content)}`,
    `document.title: ${clean(document.title)}`,
    '', '== 标题 ==', ...heads,
    '', '== 链接（位置 | 路径 | 文字 | 是否含图） ==', ...links,
    '', '== 按钮 ==', ...buttons,
    '', '== 最大的图片 ==', ...imgs,
    '', '== 含关键词的文字行 ==', ...lines,
  ].join('\n');
}

/**
 * 页面上能看到的按钮、标签、标题文字（只取短文字），读取失败时写进报告，方便定位问题。
 * 不包含地址等长文本。
 */
export function pageHints() {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const uniq = (arr, n, max = 40) => [...new Set(arr.filter((t) => t && t.length <= max))].slice(0, n);
  const inChrome = (el) => !!el.closest('header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [class*="header" i], [class*="footer" i], [class*="navbar" i], [id*="onetrust" i], [class*="cookie" i]');
  // 像地址、电话、邮编的行不收集
  const PRIVATE = /\b\d{5}(-\d{4})?\b|\b\d+\s+[a-z]+.*\b(st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|way|ct|court|apt|suite|unit|pl|place|hwy)\b|\(\d{3}\)\s*\d{3}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|@[a-z0-9-]+\.[a-z]/i;
  const shortPath = (href) => { try { const u = new URL(href, location.href); return (u.host !== location.host ? u.host : '') + u.pathname.slice(0, 50); } catch { return ''; } };

  const main = (el) => visible(el) && !inChrome(el);
  const btns = uniq([...document.querySelectorAll('button, [role="button"], [role="tab"], select option')]
    .filter((el) => el.tagName === 'OPTION' || main(el))
    .map((el) => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'))), 25);
  const links = uniq([...document.querySelectorAll('a[href]')].filter(main)
    .map((a) => `${clean(a.innerText || a.getAttribute('aria-label') || a.getAttribute('title')).slice(0, 30) || '(无文字)'} → ${shortPath(a.getAttribute('href'))}`), 20, 100);
  const heads = uniq([...document.querySelectorAll('h1, h2, h3, h4')].filter(main).map((h) => clean(h.innerText)), 12, 60);
  const imgs = [...document.images].filter(main).map((img) => {
    const r = img.getBoundingClientRect();
    return { area: r.width * r.height, s: `${Math.round(r.width)}x${Math.round(r.height)} ${shortPath(img.currentSrc || img.src)} alt="${clean(img.alt).slice(0, 50)}"` };
  }).sort((a, b) => b.area - a.area).slice(0, 5).map((x) => x.s);

  // 页面主体里的短文字（逐个文本节点收集，跳过导航、页脚、弹窗和像地址的行）
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && texts.length < 200) {
    const n = walker.currentNode;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName) || !main(el)) continue;
    const t = clean(n.textContent);
    if (t.length >= 2 && t.length <= 70 && !PRIVATE.test(t)) texts.push(t);
  }

  const listingLinks = [...document.querySelectorAll('a[href]')]
    .filter((a) => /\/(itm|listing|listings|item|items|products)\//i.test(a.getAttribute('href') || '')).length;
  return {
    path: location.pathname + location.search,
    docTitle: clean(document.title).slice(0, 80),
    headings: heads,
    buttons: btns,
    links,
    images: imgs,
    texts: uniq(texts, 40, 70),
    listingLinks,
    iframes: document.querySelectorAll('iframe').length,
  };
}

/**
 * 列表模式（Depop）：订单信息和「Download shipping label」都在列表的每一行上。
 * 每行读取：订单号、图片、SKU、件数、是否已寄出、有没有下载面单按钮。不读取买家信息。
 */
export function extractListRows(patternSource) {
  const re = new RegExp(patternSource, 'i');
  const idRe = /\/sold-items\/(\d{6,})/i;
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const idOf = (a) => { const m = (a.getAttribute('href') || '').match(idRe); return m ? m[1] : ''; };
  // 只看能看见的链接：「All」等隐藏的标签页内容也在页面里，不能算进来
  const anchors = [...document.querySelectorAll('a[href]')].filter((a) => re.test(a.href) && idOf(a) && visible(a));
  const ids = [...new Set(anchors.map(idOf))];
  const rows = [];
  for (const id of ids) {
    // 这一行 = 从链接往上，直到再往上就会包含别的订单号
    const a = anchors.find((x) => idOf(x) === id);
    let row = a;
    for (let n = a.parentElement; n && n !== document.body; n = n.parentElement) {
      if (anchors.some((x) => idOf(x) !== id && n.contains(x))) break;
      row = n;
    }
    const text = row.innerText || '';
    const lines = text.split('\n').map(clean).filter(Boolean);
    // SKU：「SKU:」后面同一行或下一行
    const skus = [];
    lines.forEach((l, k) => {
      const m = l.match(/^sku\s*[:#]?\s*(.*)$/i);
      if (!m) return;
      const v = (m[1] || lines[k + 1] || '').trim();
      if (v && /^[A-Za-z0-9][\w.\-\/]{1,40}$/.test(v)) skus.push(v);
    });
    const imgs = [...row.querySelectorAll('img')].filter((img) => visible(img) && /^https?:/.test(img.currentSrc || img.src)
      && !/avatar|profile|user|logo|icon/i.test(`${img.currentSrc || img.src} ${img.className}`));
    const nm = text.match(/(\d+)\s+items?\s+sold/i);
    const count = Math.max(nm ? parseInt(nm[1], 10) : 1, skus.length, 1);
    const shipped = lines.find((l) => /^(shipped|delivered|in transit|completed|cancell?ed|refunded)$/i.test(l)) || '';
    const hasLabelButton = [...row.querySelectorAll('a, button, [role="button"]')]
      .some((b) => /download\s*(shipping\s*)?label/i.test(clean(b.innerText || b.getAttribute('aria-label'))));
    rows.push({
      orderId: id,
      url: `${location.origin}/sellinghub/sold-items/${id}/`,
      shipped,
      hasLabelButton,
      items: Array.from({ length: count }, (_, k) => ({
        sku: skus[k] || '',
        imageUrl: imgs[k] ? (imgs[k].currentSrc || imgs[k].src) : (imgs[0] ? (imgs[0].currentSrc || imgs[0].src) : ''),
        qty: 1,
      })),
    });
  }
  return rows;
}

/** 列表模式：点某一行（订单号）自己的「Download shipping label」。 */
export function clickRowLabel(orderId, patternSource) {
  const re = new RegExp(patternSource, 'i');
  const idRe = /\/sold-items\/(\d{6,})/i;
  const idOf = (a) => { const m = (a.getAttribute('href') || '').match(idRe); return m ? m[1] : ''; };
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const anchors = [...document.querySelectorAll('a[href]')].filter((a) => re.test(a.href) && idOf(a) && visible(a));
  const a = anchors.find((x) => idOf(x) === orderId);
  if (!a) return { clicked: false, why: '列表里找不到这一单' };
  let row = a;
  for (let n = a.parentElement; n && n !== document.body; n = n.parentElement) {
    if (anchors.some((x) => idOf(x) !== orderId && n.contains(x))) break;
    row = n;
  }
  const btn = [...row.querySelectorAll('a, button, [role="button"]')]
    .find((b) => visible(b) && /download\s*(shipping\s*)?label/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
  if (!btn) return { clicked: false, why: '这一行没有「Download shipping label」按钮' };
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return { clicked: true, text: (btn.innerText || '').trim() };
}

/** 面单在一个网页里显示（而不是直接是 PDF）时，找出里面嵌着的 PDF 或面单图片地址。 */
export function findEmbeddedLabel() {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  const out = [];
  for (const el of document.querySelectorAll('embed[src], iframe[src], object[data]')) out.push({ kind: 'frame', url: abs(el.getAttribute('src') || el.getAttribute('data')) });
  for (const a of document.querySelectorAll('a[href]')) if (/\.pdf(\?|$)|label/i.test(a.getAttribute('href'))) out.push({ kind: 'link', url: abs(a.getAttribute('href')) });
  const big = [...document.images].map((img) => ({ img, r: img.getBoundingClientRect() }))
    .filter(({ r }) => r.width >= 250 && r.height >= 250).sort((x, y) => y.r.width * y.r.height - x.r.width * x.r.height);
  if (big.length) out.push({ kind: 'image', url: big[0].img.currentSrc || big[0].img.src });
  return out.filter((x) => /^https?:|^blob:|^data:/.test(x.url));
}

/** 在列表页点击文字为 label 的筛选按钮 / 标签（如 Depop 的「To ship」）。下拉框也支持。 */
export function clickFilter(label) {
  const want = String(label).trim().toLowerCase().replace(/\s+/g, ' ');
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const own = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').toLowerCase();
  // 文字可能带数量，如「To ship (3)」「To ship 3」「To ship · 3」
  const match = (t) => t === want
    || (t.startsWith(want) && t.length <= want.length + 8 && /^[\s(·•-]*\d+\)?$/.test(t.slice(want.length)));
  // 下拉框：<select> 里有这个选项就选中它
  for (const s of document.querySelectorAll('select')) {
    const opt = [...s.options].find((o) => match(own(o)));
    if (opt) {
      s.value = opt.value;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return { clicked: true, text: opt.textContent.trim() };
    }
  }
  const sel = '[role="tab"], button, [role="button"], [role="option"], [role="radio"], a, label, li, span, div, p';
  const cands = [...document.querySelectorAll(sel)].filter((el) => visible(el) && match(own(el)));
  if (!cands.length) return { clicked: false };
  // 优先选真正可点击的元素；同等条件下选文字最短（最内层）的
  const CLICKABLE = '[role="tab"], button, [role="button"], [role="option"], [role="radio"], a, label';
  const rank = (el) => (el.matches(CLICKABLE) ? 0 : 1) * 1000 + own(el).length;
  cands.sort((a, b) => rank(a) - rank(b));
  const target = cands[0].closest(CLICKABLE) || cands[0];
  target.click();
  return { clicked: true, text: (target.innerText || '').trim().slice(0, 40) };
}

/** 列表页可能是滚动加载：一直往下滚，直到订单链接数量不再增加。 */
export async function scrollToLoadAll(patternSource) {
  const re = new RegExp(patternSource, 'i');
  const count = () => [...document.querySelectorAll('a[href]')].filter((a) => re.test(a.href)).length;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 20 && stable < 2; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await wait(1200);
    const n = count();
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
  window.scrollTo(0, 0);
  return last;
}

/** 在列表页（待发货 / 已售）收集所有订单详情链接。patternSource 为正则字符串。 */
export function collectOrderLinks(patternSource) {
  const re = new RegExp(patternSource, 'i');
  // 列表里这一行显示已寄出（Mercari：Awaiting rating from buyer）就不收集
  const SHIPPED_ROW = /awaiting (buyer'?s? )?rating|waiting for (the )?buyer'?s? (rating|review)|in transit|\bdelivered\b|order complete|sale complete|rate (the )?buyer/i;
  const orderAnchors = [...document.querySelectorAll('a[href]')].filter((a) => re.test(a.href));
  const keyOf = (href) => {
    const u = new URL(href);
    // eBay 的订单号在查询参数里，要保留；其他平台去掉 ?action=… 之类的参数，避免同一订单重复
    const keep = u.searchParams.get('orderid') || u.searchParams.get('orderId');
    const url = keep ? href : `${u.origin}${u.pathname}`;
    return { url, key: keep ? `orderid:${keep}` : url.toLowerCase().replace(/\/$/, '') };
  };
  // 这一行的文字：从链接往上找，直到再往上就会包含别的订单为止
  const rowText = (a, key) => {
    let row = a;
    for (let node = a.parentElement; node && node !== document.body; node = node.parentElement) {
      const others = [...node.querySelectorAll('a[href]')].some((x) => {
        if (!re.test(x.href)) return false;
        try { return keyOf(x.href).key !== key; } catch { return false; }
      });
      if (others) break;
      row = node;
    }
    return row.innerText || '';
  };
  const seen = new Map();
  const shipped = new Set();
  for (const a of orderAnchors) {
    let k;
    try { k = keyOf(a.href); } catch { continue; }
    if (shipped.has(k.key) || seen.has(k.key)) continue;
    if (SHIPPED_ROW.test(rowText(a, k.key))) { shipped.add(k.key); continue; }
    seen.set(k.key, k.url);
  }
  return [...seen.values()];
}

/**
 * 在网页自己的环境（MAIN world）里装钩子：记录网页之后生成的 PDF / 图片 blob。
 * 网站点「下载」时常常先在网页里生成文件再下载；截住它就不需要读电脑上的文件。
 */
export function installBlobHook() {
  if (window.__phHooked) { window.__phBlobs = []; return true; }
  window.__phHooked = true;
  window.__phBlobs = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    try {
      if (obj instanceof Blob && (/pdf|image|octet-stream/i.test(obj.type) || obj.type === '')) window.__phBlobs.push(obj);
    } catch { /* ignore */ }
    return orig.apply(this, arguments);
  };
  return true;
}

/** 取钩子记录到的最新一个 PDF / 图片，返回 base64（没有就返回 null）。 */
export async function readHookedBlob() {
  const list = window.__phBlobs || [];
  for (let k = list.length - 1; k >= 0; k--) {
    const u8 = new Uint8Array(await list[k].arrayBuffer());
    const isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
    const isImg = (u8[0] === 0x89 && u8[1] === 0x50) || (u8[0] === 0xff && u8[1] === 0xd8);
    if (!isPdf && !isImg) continue;
    window.__phBlobs = [];
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return null;
}

/**
 * 点了下载后弹出确认框（Poshmark：「Download Shipping Label」弹窗里还有一个 Download）。
 * 在弹窗里找「Download / Print」按钮点一下；绝不点 Cancel / Close / Upgrade。
 */
export function clickModalDownload() {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
  const GOOD = /^(download|download (shipping )?label|download pdf|print|print (shipping )?label)$/i;
  const isModal = (el) => {
    for (let n = el, lvl = 0; n && lvl < 8; n = n.parentElement, lvl++) {
      if (n.matches && n.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog, [class*="modal" i], [class*="dialog" i], [class*="popup" i], [class*="overlay" i]')) return true;
      const pos = getComputedStyle(n).position;
      if ((pos === 'fixed') && /shipping label|download/i.test(n.innerText || '')) return true;
    }
    return false;
  };
  const cands = [...document.querySelectorAll('button, a, [role="button"]')]
    .filter((el) => visible(el) && GOOD.test(txt(el)) && isModal(el));
  if (!cands.length) return { clicked: false };
  const btn = cands[cands.length - 1]; // 弹窗通常在页面最后面
  btn.click();
  return { clicked: true, text: txt(btn) };
}

/**
 * Depop：按商品图片编号找商品描述（MAIN world 里运行）。
 * 数据来源：页面自带的 __NEXT_DATA__ / __NUXT__ 等，以及 nethook.js 记下的网络 JSON。
 * imageIds：图片网址里的编号（如 4420321717）。返回 {imageId: 描述文字}。
 */
export function findDescriptionsByImage(imageIds) {
  const want = new Set(imageIds.filter(Boolean));
  const sources = [];
  try { const el = document.getElementById('__NEXT_DATA__'); if (el) sources.push(JSON.parse(el.textContent)); } catch { /* ignore */ }
  for (const k of ['__NEXT_DATA__', '__NUXT__', '__APOLLO_STATE__', '__INITIAL_STATE__', '__PRELOADED_STATE__']) {
    try { if (window[k]) sources.push(window[k]); } catch { /* ignore */ }
  }
  for (const n of window.__phNet || []) sources.push(n.data);
  const TEXT_KEYS = ['description', 'title', 'name', 'productDescription', 'itemDescription'];
  const found = {};
  const seen = new WeakSet();
  // 深度遍历：找「含有某个图片编号」且「有描述字段」的最小对象
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 40) return new Set();
    seen.add(node);
    const idsHere = new Set();
    const vals = Array.isArray(node) ? node : Object.values(node);
    for (const v of vals) {
      if (typeof v === 'string') { for (const id of want) if (v.includes(id)) idsHere.add(id); }
      else if (v && typeof v === 'object') for (const id of walk(v, depth + 1)) idsHere.add(id);
    }
    if (!Array.isArray(node) && idsHere.size === 1) {
      const id = [...idsHere][0];
      if (!found[id]) {
        for (const k of TEXT_KEYS) {
          const t = node[k];
          if (typeof t === 'string' && t.trim().length >= 4 && !/^https?:/.test(t)) { found[id] = t; break; }
        }
      }
    }
    return idsHere;
  };
  for (const src of sources) { try { walk(src, 0); } catch { /* ignore */ } }
  return { found, sources: sources.length };
}
