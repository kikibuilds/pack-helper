// 合并面单：把所有面单按编号合成一个 PDF，并可在每张面单前插一张同尺寸的「对照卡」。
// 对照卡用 canvas 画（支持中文和商品图），再作为图片放进 PDF 页面。
// 依赖 pdf-lib（lib/pdf-lib.min.js，MIT），在批次页里以 window.PDFLib 提供。
import { PLATFORM_META } from './report.js';

const PT = 72; // 每英寸点数

function wrap(ctx, text, maxW, maxLines) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxW && line) {
      out.push(line);
      line = ch;
      if (out.length === maxLines) break;
    } else line = next;
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines && ctx.measureText(out[maxLines - 1]).width > maxW * 0.95) out[maxLines - 1] = out[maxLines - 1].slice(0, -1) + '…';
  return out;
}

/**
 * 画对照卡（纯文字，适合热敏纸）。group：同一个包裹（同编号）的所有行。
 * 尺寸和后面那张面单一样。件数多时自动缩小字号；再多就分成几张（第 2 张起标「续」），
 * 保证字不会小到看不清。返回 PNG 字节数组（每张一个）。
 */
async function drawCards(group, wPt, hPt) {
  const scale = 200 / PT; // 200 dpi
  const W = Math.round(wPt * scale);
  const H = Math.round(hPt * scale);
  const u = Math.min(W, H) / 100; // 相对单位，适配 4x6 和 letter
  const font = (px, bold) => `${bold ? '700 ' : ''}${Math.round(px)}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const first = group[0];
  const meta = PLATFORM_META[first.platform] || PLATFORM_META.other;
  const pad = u * 6;
  const units = group.reduce((s, r) => s + r.qty, 0);

  // 版面规划：第一张有大表头，续页表头小一些
  const HEAD1 = u * 52;
  const HEADN = u * 20;
  const FOOT = u * 12;
  const MIN_ROW = u * 11;  // 一件商品至少占这么高（SKU ≥ 4.6u ≈ 13pt 粗体，商品名 1 行 ≈ 9pt）
  const BIG_ROW = u * 30;  // 件数少时每件最多这么高
  const cap1 = Math.max(1, Math.floor((H - HEAD1 - FOOT) / MIN_ROW));
  const capN = Math.max(1, Math.floor((H - HEADN - FOOT) / MIN_ROW));
  // 需要几张卡；商品平均分到各张，避免第一张挤、最后一张空
  const n = group.length;
  const nPages = n <= cap1 ? 1 : 1 + Math.ceil((n - cap1) / capN);
  const per = Math.ceil(n / nPages);
  const pages = [];
  let rest = [...group];
  pages.push(rest.splice(0, Math.min(per, cap1)));
  while (rest.length) {
    const left = nPages - pages.length;
    pages.push(rest.splice(0, Math.min(capN, Math.ceil(rest.length / Math.max(1, left)))));
  }

  const out = [];
  for (const [pi, items] of pages.entries()) {
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#111'; ctx.lineWidth = u * 0.8; ctx.setLineDash([u * 2, u * 1.5]);
    ctx.strokeRect(u * 2, u * 2, W - u * 4, H - u * 4);
    ctx.setLineDash([]);
    ctx.textBaseline = 'top';
    let y = pad;
    const pageTag = pages.length > 1 ? `（第 ${pi + 1}/${pages.length} 张）` : '';
    if (pi === 0) {
      ctx.fillStyle = '#111'; ctx.font = font(u * 30, true);
      ctx.fillText(first.code, pad, y);
      ctx.font = font(u * 7, true);
      ctx.fillText(meta.name, W - pad - ctx.measureText(meta.name).width, y + u * 3);
      y += u * 32;
      ctx.font = font(u * 4.2);
      ctx.fillText(`订单 ${first.orderId || '—'}`, pad, y); y += u * 5.5;
      ctx.font = font(u * 4.2, true);
      ctx.fillText(`本包裹共 ${units} 件${group.length > 1 ? `（${group.length} 种商品）` : ''}${pageTag}`, pad, y);
      y = HEAD1 - u * 1.5;
    } else {
      ctx.fillStyle = '#111'; ctx.font = font(u * 12, true);
      ctx.fillText(`${first.code} 续`, pad, y);
      ctx.font = font(u * 4.2, true);
      const t = `${meta.name} · ${pageTag}`;
      ctx.fillText(t, W - pad - ctx.measureText(t).width, y + u * 4);
      y = HEADN - u * 1.5;
    }
    ctx.fillStyle = '#111'; ctx.fillRect(pad, y, W - pad * 2, u * 0.5);
    y += u * 2;

    // 每件的高度：件数少就大，件数多就小（不小于 MIN_ROW）
    const avail = H - y - FOOT;
    const rowH = Math.max(MIN_ROW, Math.min(BIG_ROW, avail / items.length));
    const skuSize = Math.min(u * 9, rowH * 0.42);
    const titleSize = Math.max(u * 3.2, Math.min(u * 4.6, rowH * 0.24));
    for (const [k, r] of items.entries()) {
      let ly = y + u * 1;
      const qtyText = `× ${r.qty}`;
      ctx.font = font(skuSize * 1.05, true);
      const qtyW = ctx.measureText(qtyText).width;
      // SKU 太长时缩小字号
      let sz = skuSize;
      ctx.font = font(sz, true);
      const skuText = r.sku || '无 SKU';
      while (ctx.measureText(skuText).width > W - pad * 2 - qtyW - u * 5 && sz > u * 3) { sz -= u * 0.4; ctx.font = font(sz, true); }
      ctx.fillStyle = '#111';
      ctx.fillText(skuText, pad, ly);
      ctx.font = font(skuSize * 1.05, true);
      if (r.qty > 1) { // 多件：反白显示，热敏纸上也很醒目
        ctx.fillRect(W - pad - qtyW - u * 1.5, ly - u * 0.6, qtyW + u * 3, skuSize * 1.05 + u * 1.2);
        ctx.fillStyle = '#fff';
      }
      ctx.fillText(qtyText, W - pad - qtyW, ly);
      ly += skuSize * 1.2;
      ctx.fillStyle = '#111'; ctx.font = font(titleSize);
      const maxLines = Math.max(1, Math.min(4, Math.floor((rowH - skuSize * 1.2 - u * 2) / (titleSize * 1.2))));
      for (const line of wrap(ctx, r.title || '', W - pad * 2, maxLines)) {
        ctx.fillText(line, pad, ly); ly += titleSize * 1.2;
      }
      y += rowH;
      if (k < items.length - 1) { ctx.fillStyle = '#9ca3af'; ctx.fillRect(pad, y - u * 0.6, W - pad * 2, u * 0.3); }
    }
    // 底部提示
    ctx.fillStyle = '#111'; ctx.font = font(u * 4.2, true);
    const tip = pi < pages.length - 1 ? '↓ 下一张是这个包裹的对照卡（续）' : '↓ 下一张就是这个包裹的面单';
    ctx.fillText(tip, (W - ctx.measureText(tip).width) / 2, H - pad - u * 4);
    const blob = await c.convertToBlob({ type: 'image/png' });
    out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

/**
 * @param rows assignCodes 的结果
 * @returns {Promise<{withCards: Uint8Array, count: number} | null>}
 */
export async function buildMergedLabels(rows, getLabel, getImage) {
  const PDFLib = globalThis.PDFLib;
  if (!PDFLib || !rows.some((r) => r.labelFile)) return null;
  const { PDFDocument } = PDFLib;
  const groups = [];
  for (const r of rows) {
    if (!r.labelFile) continue;
    const g = groups.find((x) => x[0].code === r.code);
    if (g) g.push(r); else groups.push([r]);
  }
  const cards = await PDFDocument.create();
  let count = 0;
  for (const group of groups) {
    const blob = await getLabel(group[0].labelOwnerId);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // 面单页（PDF 或图片）
    const addLabel = async (doc) => {
      if (blob.type.startsWith('image/')) {
        const im = blob.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const w = 4 * PT; const h = 6 * PT;
        const page = doc.addPage([w, h]);
        const s = Math.min(w / im.width, h / im.height);
        page.drawImage(im, { x: (w - im.width * s) / 2, y: (h - im.height * s) / 2, width: im.width * s, height: im.height * s });
        return [[w, h]];
      }
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      return pages.map((p) => { doc.addPage(p); const { width, height } = p.getSize(); return [width, height]; });
    };
    // 对照卡和面单第一页一样大
    let w = 4 * PT; let h = 6 * PT;
    if (!blob.type.startsWith('image/')) {
      const first = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPage(0).getSize();
      w = first.width; h = first.height;
    }
    for (const png of await drawCards(group, w, h)) {
      const cardImg = await cards.embedPng(png);
      cards.addPage([w, h]).drawImage(cardImg, { x: 0, y: 0, width: w, height: h });
    }
    await addLabel(cards);
    count++;
  }
  return { withCards: await cards.save(), count };
}
