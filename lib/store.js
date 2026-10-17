// 批次数据：订单列表放在 chrome.storage.local，图片和面单放在 IndexedDB。
import { idbPut, idbGet, idbDel, idbClear } from './db.js';

// 一键全自动运行覆盖的平台：都是平台预付面单、直接下载即可的。
// eBay（以及 Etsy、Shopify）需要自己买面单，之后单独处理。
export const AUTO_PLATFORMS = ['poshmark', 'mercari', 'depop'];

export const DEFAULT_SETTINGS = {
  autoCapture: true,
  // 发货文件保存在 Chrome「下载内容」文件夹下的哪个子文件夹（Chrome 只允许存在下载文件夹里面）
  outDir: '发货',
  // 发邮件用的发件邮箱（Gmail）。Mac 上的邮件程序要为这个邮箱保存过应用专用密码（运行 install.sh）
  emailFrom: '', // 第一次用时在「设置 → 邮件」里填（已经保存过的设置不受影响）
  emailTo: [],
  // 每封发货邮件都密送给这些邮箱（比如老板自己），收件人看不到
  emailBcc: [],
  // 邮件标题 / 正文模板；空 = 用默认（见 report.js 的 DEFAULT_EMAIL_SUBJECT / DEFAULT_EMAIL_BODY）
  emailSubject: '',
  emailBody: '',
  // 远程指令（邮件触发）：白名单邮箱发来、标题带暗号的邮件 → 自动拉取 / 打包 / 发邮件
  remote: {
    enabled: false,
    allow: [], // 允许发指令的邮箱（只存在这台电脑的 Chrome 里）
    secret: '', // 暗号：标题里要带这个
    intervalMin: 2, // 每几分钟查一次收件箱
    sendTo: '', // 打包后发给谁：收件人列表里的一个，或 '__all__'
    includePacked: true, // 远程打包时全选：之前打包过、平台上还显示待发货的也打包
  },
  // 运行状况：心跳（掉线报警）和每日登录检查
  health: {
    heartbeatEnabled: false,
    heartbeatUrl: '', // 外部监控服务给的心跳网址，比如 https://hc-ping.com/<你的 UUID>
    heartbeatMin: 5, // 每几分钟报一次平安（监控服务那边的「周期」要设得比这个长）
    loginCheckEnabled: false,
    loginCheckTime: '08:00', // 每天几点检查（这台电脑的时间）
    loginCheckNotify: '', // 发现需要重新登录时发邮件给谁（用「邮件」里的发件邮箱发）
  },
  // 一键全自动运行时打开的「待发货」列表页。第一次使用请换成你在各平台实际看到的地址。
  listUrls: {
    poshmark: 'https://poshmark.com/order/sales?status=to_ship',
    mercari: 'https://www.mercari.com/mypage/listings/in_progress/',
    depop: 'https://www.depop.com/sellinghub/sold-items/', // 运行时 selling-hub 写法也会自动试
  },
  // 打开列表页后先点的筛选按钮（按钮上的文字）。找不到这个按钮时会跳过该平台，避免把已发货订单也打包进去。
  listFilters: {
    poshmark: '',
    mercari: '',
    depop: 'To ship',
  },
  patterns: {
    ebay: 'ord/details\\?.*orderid=',
    poshmark: '/order/sales/[a-z0-9]+',
    mercari: '/transaction/[a-z0-9]+',
    depop: '/sold-items/\\d{6,}',
  },
};

// 旧版本保存过的默认值，升级时换成新默认值（你自己改过的不动）
const OLD_DEFAULTS = {
  listUrls: {
    depop: [],
    poshmark: ['https://poshmark.com/order/sales', 'https://poshmark.com/order/sales/'],
  },
  patterns: { depop: ['/(sold-items|receipts?)/[\\w-]+'] },
};
function migrate(group, saved) {
  const out = { ...DEFAULT_SETTINGS[group], ...(saved || {}) };
  for (const [k, olds] of Object.entries(OLD_DEFAULTS[group] || {})) {
    if (olds.includes(out[k])) out[k] = DEFAULT_SETTINGS[group][k];
  }
  return out;
}

export function detectPlatform(url) {
  if (!url) return '';
  let host = '';
  try { host = new URL(url).hostname; } catch { return ''; }
  if (host.includes('ebay')) return 'ebay';
  if (host.includes('poshmark')) return 'poshmark';
  if (host.includes('mercari') || host.includes('mercdn')) return 'mercari';
  if (host.includes('depop')) return 'depop';
  return '';
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    patterns: migrate('patterns', settings && settings.patterns),
    listUrls: migrate('listUrls', settings && settings.listUrls),
    listFilters: { ...DEFAULT_SETTINGS.listFilters, ...((settings && settings.listFilters) || {}) },
    remote: { ...DEFAULT_SETTINGS.remote, ...((settings && settings.remote) || {}) },
    health: { ...DEFAULT_SETTINGS.health, ...((settings && settings.health) || {}) },
    // 旧版默认的保存文件夹叫「发货包」，统一改名为「发货」（自己改过的不动）
    ...(settings && settings.outDir === '发货包' ? { outDir: '发货' } : {}),
  };
}

// —— 已打包记录：同一订单不会出现在两个发货文件里（记录保留 45 天） ——
const SENT_KEEP_MS = 45 * 24 * 3600 * 1000;
const sentKey = (o) => (o.orderId ? `${o.platform}|${o.orderId}` : '');
export async function getSent() {
  const { sentOrders = {} } = await chrome.storage.local.get('sentOrders');
  return sentOrders;
}
export async function isSent(o) {
  const k = sentKey(o);
  return !!(k && (await getSent())[k]);
}
export async function markSent(orders) {
  const sent = await getSent();
  const now = Date.now();
  for (const k of Object.keys(sent)) if (now - sent[k] > SENT_KEEP_MS) delete sent[k];
  for (const o of orders) { const k = sentKey(o); if (k) sent[k] = now; }
  await chrome.storage.local.set({ sentOrders: sent });
}
export const clearSent = () => chrome.storage.local.set({ sentOrders: {} });
/** 去掉某些订单的「已打包」记录：之后再拉取时当作新订单 */
export async function unmarkSent(orders) {
  const sent = await getSent();
  for (const o of orders) { const k = sentKey(o); if (k) delete sent[k]; }
  await chrome.storage.local.set({ sentOrders: sent });
}
export const saveSettings = (settings) => chrome.storage.local.set({ settings });

/** 子文件夹路径清洗：只允许相对路径，去掉 .. 和不能用在文件名里的字符；空了就用默认值 */
export function cleanOutDir(v) {
  const parts = String(v || '').replace(/\\/g, '/').split('/')
    .map((p) => p.trim().replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+$/, ''))
    .filter(Boolean);
  return parts.join('/').slice(0, 120) || DEFAULT_SETTINGS.outDir;
}

export async function getOrders() {
  const { orders = [] } = await chrome.storage.local.get('orders');
  return orders;
}
async function saveOrders(orders) {
  await chrome.storage.local.set({ orders });
  try { await chrome.action.setBadgeText({ text: orders.length ? String(orders.length) : '' }); } catch { /* 页面中可能不可用 */ }
}

// —— 商品名 → SKU 记忆（没有 SKU 的平台，填过一次以后自动带出） ——
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
// 太短或像网站按钮的"商品名"不参与 SKU 记忆，避免一个读错的标题把 SKU 套到所有订单上
const GENERIC_TITLE = /^(sell( now)?|my listings|shop|home|listing|item|order|sales|order status|privacy settings|(product |item |listing )?(image|photo|picture)s?)$/;
const memorable = (title) => { const n = normTitle(title); return n.length >= 8 && !GENERIC_TITLE.test(n) && !/请看图|未读到商品名/.test(String(title)); };
export async function suggestSku(title) {
  if (!memorable(title)) return '';
  const { skuMap = {} } = await chrome.storage.local.get('skuMap');
  return skuMap[normTitle(title)] || '';
}
export async function rememberSku(title, sku) {
  if (!title || !sku || !memorable(title)) return;
  const { skuMap = {} } = await chrome.storage.local.get('skuMap');
  skuMap[normTitle(title)] = sku;
  // 反查表：SKU → 商品名（原样保存），给没有标题的平台（Depop）用
  const { skuTitles = {} } = await chrome.storage.local.get('skuTitles');
  skuTitles[sku.toLowerCase()] = String(title).trim();
  await chrome.storage.local.set({ skuMap, skuTitles });
}
export async function titleForSku(sku) {
  if (!sku) return '';
  const { skuTitles = {} } = await chrome.storage.local.get('skuTitles');
  return skuTitles[String(sku).toLowerCase()] || '';
}

async function fetchBlob(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}

/** 加入一条订单；同平台、同订单号、同商品名的会更新而不是重复添加。 */
export async function addOrder(data) {
  const orders = await getOrders();
  // 同平台、同订单号、同一件（itemIndex，多件订单才有）视为同一行，重跑时更新这一行
  const idx = data.itemIndex || 0;
  const same = data.orderId ? orders.filter((o) => o.platform === data.platform && o.orderId === data.orderId) : [];
  let order = same.find((o) => (o.itemIndex || 0) === idx)
    || (idx === 0 && same.length === 1 ? same[0] : same.find((o) => o.title === data.title));
  const isNew = !order;
  if (isNew) {
    order = {
      id: crypto.randomUUID(), addedAt: Date.now(), hasImage: false, hasLabel: false,
      // include：「打包下载」时要不要打进这次的发货文件；之前打包过的默认不勾
      include: data.include !== undefined ? !!data.include : true,
      edited: [],
    };
    orders.push(order);
  }
  const prevImageUrl = order.imageUrl;
  const fresh = {
    itemIndex: idx,
    platform: data.platform || 'other',
    url: data.url || order.url || '',
    orderId: (data.orderId || '').trim(),
    title: (data.title || '').trim(),
    imageUrl: data.imageUrl || order.imageUrl || '',
    sku: (data.sku || '').trim() || (await suggestSku(data.title)),
    qty: Math.max(1, parseInt(data.qty, 10) || 1),
    trackingLast4: (data.trackingLast4 || order.trackingLast4 || '').trim(),
    source: data.source || order.source || 'manual',
    runId: data.runId || order.runId || 0,
    prevPacked: !!data.prevPacked,
    autoTitle: !!data.autoTitle,
  };
  // 你在批次页手动改过的字段，重新拉取时不覆盖
  for (const f of order.edited || []) delete fresh[f];
  Object.assign(order, fresh);
  if (order.sku && !order.autoTitle) await rememberSku(order.title, order.sku);
  if (order.imageUrl && (!order.hasImage || order.imageUrl !== prevImageUrl)) {
    try {
      await idbPut(`img:${order.id}`, await fetchBlob(order.imageUrl));
      order.hasImage = true;
    } catch { /* 图片抓不到时，打包清单里退回使用网络图片地址 */ }
  }
  await saveOrders(orders);
  return { order, isNew };
}

/** manual=true：你在批次页亲手改的，记下来，重新拉取时保留你的修改 */
export async function updateOrder(id, patch, { manual = false } = {}) {
  const orders = await getOrders();
  const o = orders.find((x) => x.id === id);
  if (!o) return;
  Object.assign(o, patch);
  if (manual) {
    o.edited = [...new Set([...(o.edited || []), ...Object.keys(patch).filter((k) => ['title', 'sku', 'qty', 'orderId', 'trackingLast4'].includes(k))])];
    if (patch.title !== undefined) o.autoTitle = false;
  }
  if (patch.sku !== undefined || patch.title !== undefined) await rememberSku(o.title, o.sku);
  await saveOrders(orders);
}

/** 拉取结束后：这个平台本次没再出现的自动行（多半已经发货了）从批次里去掉 */
export async function pruneStale(platforms, runId) {
  const orders = await getOrders();
  const stale = orders.filter((o) => o.source === 'auto' && platforms.includes(o.platform) && o.runId !== runId);
  for (const o of stale) await removeOrder(o.id);
  return stale.length;
}

/** 多件订单：复制一行（同订单号，换商品）。 */
export async function duplicateOrder(id) {
  const orders = await getOrders();
  const o = orders.find((x) => x.id === id);
  if (!o) return;
  const maxIdx = Math.max(...orders.filter((x) => x.platform === o.platform && x.orderId === o.orderId).map((x) => x.itemIndex || 0));
  // 手动加的件：不会被重新拉取覆盖或删除
  orders.push({ ...o, id: crypto.randomUUID(), addedAt: o.addedAt + 1, title: '', sku: '', qty: 1,
    imageUrl: '', hasImage: false, hasLabel: false, itemIndex: maxIdx + 100, source: 'manual', edited: [], labelError: '' });
  await saveOrders(orders);
}

export async function removeOrder(id) {
  await saveOrders((await getOrders()).filter((o) => o.id !== id));
  await idbDel(`img:${id}`);
  await idbDel(`label:${id}`);
}

export async function clearBatch() {
  await chrome.storage.local.set({ orders: [], labelPool: [] });
  await idbClear();
  try { await chrome.action.setBadgeText({ text: '' }); } catch { /* ignore */ }
}

export const getImage = (id) => idbGet(`img:${id}`);
export const getLabel = (id) => idbGet(`label:${id}`);

/**
 * 在批次页手动加一件商品。
 * joinGroup：加进已有的包裹（值是「平台|订单号」），这时平台和订单号跟那个包裹一样；不填就是新包裹。
 * 图片、面单都是可选的 Blob。手动加的行重新拉取时不会被删掉或覆盖。
 */
export async function addManualOrder({ joinGroup = '', platform = 'other', orderId = '', title = '', sku = '', qty = 1, imageBlob = null, labelBlob = null }) {
  const orders = await getOrders();
  const groupOf = (o) => `${o.platform}|${o.orderId || o.id}`;
  let itemIndex = 0;
  if (joinGroup) {
    const same = orders.filter((o) => groupOf(o) === joinGroup);
    if (!same.length) throw new Error('要加入的包裹已经不在批次里了，请刷新页面再试。');
    platform = same[0].platform;
    orderId = same[0].orderId || '';
    itemIndex = Math.max(...same.map((o) => o.itemIndex || 0)) + 100;
    // 没有订单号的包裹靠第一行的 id 分组：新行用同一个订单号占位，保证打进同一个包裹
    if (!orderId) {
      orderId = `手动-${same[0].id.slice(0, 6)}`;
      for (const o of same) o.orderId = orderId;
    }
  }
  const order = {
    id: crypto.randomUUID(), addedAt: Date.now(), platform: platform || 'other', orderId: String(orderId || '').trim(),
    title: String(title || '').trim(), sku: String(sku || '').trim(), qty: Math.max(1, parseInt(qty, 10) || 1),
    imageUrl: '', hasImage: false, hasLabel: false, itemIndex, source: 'manual', include: true,
    edited: ['title', 'sku', 'qty', 'orderId', 'platform'], labelError: '', url: '',
  };
  if (imageBlob) { await idbPut(`img:${order.id}`, imageBlob); order.hasImage = true; }
  orders.push(order);
  await saveOrders(orders);
  if (labelBlob) await setLabel(order.id, labelBlob);
  return order;
}

export async function setLabel(orderId, blob) {
  await idbPut(`label:${orderId}`, blob);
  const type = (blob && blob.type) || '';
  // 面单到位后清掉之前的失败原因
  const labelExt = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : type === 'image/gif' ? 'gif' : 'pdf';
  await updateOrder(orderId, { hasLabel: true, labelExt, labelError: '' });
}

// —— 面单待分配区：自动截获的下载、或当前标签页抓到的 PDF ——
export async function getPool() {
  const { labelPool = [] } = await chrome.storage.local.get('labelPool');
  return labelPool;
}
export async function addToPool({ platform, filename, blob }) {
  const pool = await getPool();
  const item = { id: crypto.randomUUID(), platform: platform || '', filename: filename || 'label.pdf', at: Date.now() };
  await idbPut(`pool:${item.id}`, blob);
  pool.push(item);
  await chrome.storage.local.set({ labelPool: pool });
  return item;
}
export async function removeFromPool(poolId) {
  await chrome.storage.local.set({ labelPool: (await getPool()).filter((p) => p.id !== poolId) });
  await idbDel(`pool:${poolId}`);
}
export async function assignPool(poolId, orderId) {
  const blob = await idbGet(`pool:${poolId}`);
  if (!blob) return false;
  await setLabel(orderId, blob);
  await removeFromPool(poolId);
  return true;
}

/** 如果该平台只剩一个订单没有面单，就自动分配给它。返回被分配的订单，或 null。 */
export async function autoAssign(poolItem) {
  const orders = await getOrders();
  const groups = new Map();
  for (const o of orders.filter((x) => x.platform === poolItem.platform)) {
    const key = o.orderId || o.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const missing = [...groups.values()].filter((g) => !g.some((o) => o.hasLabel));
  if (missing.length !== 1) return null;
  const target = missing[0][0];
  await assignPool(poolItem.id, target.id);
  return target;
}

export function isPdfBytes(u8) {
  return u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46; // %PDF
}
