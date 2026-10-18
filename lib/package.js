// 生成发货文件 zip 的字节，页面和后台都能用（不依赖 FileReader / URL.createObjectURL）。
import { assignCodes, buildPickSheetHtml, buildCsv, buildRunReport, README_TXT } from './report.js';
import { makeZip } from './zip.js';
import { getImage, getLabel, markSent, getSettings, cleanOutDir } from './store.js';
import { buildMergedLabels } from './labelsheet.js';

import { bytesToBase64 } from './b64.js';
export { bytesToBase64 };

// 生成这个发货文件的插件版本：写进打包清单、使用说明和报告，出问题时一看就知道是哪个版本
const ver = () => { try { return (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version); } catch { return '?'; } };

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    file: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`,
  };
}

/** @returns {{zip: Uint8Array, rows: object[], labelCount: number}} */
export async function buildPackage(orders, dateLabel, sheetId = '') {
  const rows = assignCodes(orders);
  const images = {};
  for (const r of rows) {
    if (!r.hasImage) continue;
    const blob = await getImage(r.id);
    if (blob) images[r.id] = `data:${blob.type || 'image/jpeg'};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  }
  const files = [
    { name: '打包清单.html', data: buildPickSheetHtml(rows, images, dateLabel, sheetId, '', ver()) },
    { name: '打包清单.csv', data: buildCsv(rows) },
    { name: '使用说明.txt', data: `${README_TXT}\n（由发货助手 V${ver()} 生成）\n` },
  ];
  const done = new Set();
  for (const r of rows) {
    if (!r.labelFile || done.has(r.labelFile)) continue;
    const blob = await getLabel(r.labelOwnerId);
    if (!blob) continue;
    done.add(r.labelFile);
    files.push({ name: r.labelFile, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  // 合并打印用：按编号顺序；「带对照卡」版每张面单前有一张同尺寸的对照卡
  try {
    const merged = await buildMergedLabels(rows, getLabel, getImage);
    if (merged) {
      files.splice(3, 0, { name: '打印-面单带对照卡.pdf', data: merged.withCards });
    }
  } catch (e) {
    files.push({ name: '合并面单失败.txt', data: `合并面单时出错：${e.message}\n单独的面单仍在「面单」文件夹里。` });
  }
  return { zip: makeZip(files), rows, labelCount: done.size };
}

/** 保存到 Chrome 下载目录下的「发货」文件夹，等下载完成再返回。需在扩展页面中调用。 */
export async function saveDownload(path, mime, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const id = await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, 60000, null);
      function done(err) {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        err ? reject(err) : resolve();
      }
      function listener(d) {
        if (d.id !== id || !d.state) return;
        if (d.state.current === 'complete') done(null);
        if (d.state.current === 'interrupted') done(new Error(`保存 ${path} 失败`));
      }
      chrome.downloads.onChanged.addListener(listener);
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/**
 * 每次运行一个文件夹，报告和发货文件放在一起：
 *   发货/发货_日期_时间/发货_日期_时间.zip
 *   发货/发货_日期_时间/报告_日期_时间.txt
 * 发邮件由批次页拿返回的 zipBytes 交给邮件程序（lib/mail.js），这里不负责。
 */
export async function exportPackage({ orders, trigger, startedAt = new Date(), extra = {}, sendTo = [], sendFrom = '' }) {
  // 文件夹按「打包的时间」命名（精确到秒），同一次拉取打包两次也不会落进同一个文件夹
  const now = new Date();
  const st = stamp(now);
  st.file += String(now.getSeconds()).padStart(2, '0');
  const dir = `${cleanOutDir((await getSettings()).outDir)}/发货_${st.file}`;
  let rows = [];
  let zipName = '';
  let sentIds = [];
  let zipBytes = null;
  if (orders.length) {
    const pkg = await buildPackage(orders, st.date, st.file);
    rows = pkg.rows;
    zipName = `发货_${st.file}.zip`;
    await saveDownload(`${dir}/${zipName}`, 'application/zip', pkg.zip);
    zipBytes = pkg.zip;
    // 只有带面单的才算"已打包"；缺面单的留在批次里，补上面单后会进入下一个发货文件
    const sent = orders.filter((o) => rows.some((r) => r.id === o.id && r.labelFile));
    await markSent(sent);
    sentIds = sent.map((o) => o.id);
  }
  const rep = buildRunReport({
    trigger, startedAt: startedAt.getTime(), finishedAt: Date.now(),
    platforms: {}, loginIssues: [], failures: [], labelFailures: [], ...extra, rows, zipName,
  });
  await saveDownload(`${dir}/报告_${st.file}.txt`, 'text/plain;charset=utf-8', new TextEncoder().encode(rep.text));
  const packaged = rows.filter((r) => sentIds.includes(r.id))
    .map((r) => ({ code: r.code, platform: r.platform, title: r.title, sku: r.sku, qty: r.qty, orderId: r.orderId, itemIndex: r.itemIndex || 0 }));
  await chrome.storage.local.set({ lastRun: { at: Date.now(), status: rep.status, summary: rep.summary, zipName, folder: dir, packaged } });
  return { ...rep, rows, zipName, sentIds, folder: dir, zipBytes, date: st.date, time: st.file.slice(11, 13) + ':' + st.file.slice(13, 15) };
}
