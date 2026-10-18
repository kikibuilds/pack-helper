// 发货：拉取 Poshmark / Mercari / Depop / Whatnot 待发货订单和面单 → 检查 → 打包下载或发邮件。
// 界面在 batch.html 的 <section data-view="shipping">，逻辑在 batch.js。
const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const key = (o) => `${o.platform}|${o.orderId || o.id}`;

export default {
  id: 'shipping',
  name: '发货',
  icon: '🚚',
  desc: '拉取 Poshmark / Mercari / Depop / Whatnot 待发货订单和面单 → 检查 → 打包下载或发邮件给打包同事',
  order: 10,
  core: true,
  view: 'shipping',
  status({ orders, local }) {
    const n = new Set(orders.map(key)).size;
    const parts = [n ? `批次里 ${n} 单` : '批次是空的'];
    if (local.lastScan) parts.push(`上次拉取 ${fmt(local.lastScan.at)}`);
    return { level: n ? 'ok' : 'off', text: parts.join(' · ') };
  },
  todos({ orders, local }) {
    const out = [];
    const missing = [...new Map(orders.filter((o) => o.include !== false && !o.hasLabel).map((o) => [key(o), o])).values()];
    if (missing.length) out.push({ level: 'warn', title: `批次里 ${missing.length} 单缺面单`, detail: '打开批次补上面单', route: '#/shipping/batch' });
    if (local.lastMail && !local.lastMail.ok) out.push({ level: 'bad', title: '上次发货邮件没发出去', detail: String(local.lastMail.error || '').split('\n')[0].slice(0, 60), route: '#/shipping/batch' });
    return out;
  },
};
