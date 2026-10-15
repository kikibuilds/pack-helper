// 后台：① 截获平台面单 PDF 下载 ② 批量扫描列表页里的订单
import { extractOrderFromPage } from './lib/extract.js';
import { addOrder, addToPool, autoAssign, detectPlatform, getSettings, getOrders, isPdfBytes } from './lib/store.js';
import { pollOnce, scheduleRemotePolling } from './lib/remote.js';

// ③ 远程指令：定时查收件箱（设置里开启后）
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'remotePoll') pollOnce('alarm').catch((e) => console.warn('remote poll', e));
});
chrome.runtime.onStartup.addListener(() => scheduleRemotePolling());
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  const o = (changes.settings.oldValue || {}).remote || {};
  const n = (changes.settings.newValue || {}).remote || {};
  if (o.enabled !== n.enabled || o.intervalMin !== n.intervalMin) scheduleRemotePolling();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'remotePollNow') {
    pollOnce('manual').then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// 点插件图标：直接打开批次页（已经开着就切过去）
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('batch.html');
  const [tab] = await chrome.tabs.query({ url: `${url}*` });
  if (tab && !/#remote/.test(tab.url || '')) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  scheduleRemotePolling();
  const orders = await getOrders();
  chrome.action.setBadgeText({ text: orders.length ? String(orders.length) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
});

// ① 面单下载截获：下载完成、是 PDF、来自四个平台 → 重新抓取一份存进批次
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current !== 'complete') return;
  const settings = await getSettings();
  const { runStatus } = await chrome.storage.local.get('runStatus');
  const running = !!(runStatus && runStatus.running); // 一键运行期间：截获的面单交给批次页去配对
  if (!settings.autoCapture && !running) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  const name = (item.filename || '').split(/[\\/]/).pop();
  const isPdf = item.mime === 'application/pdf' || /\.pdf$/i.test(name);
  if (!isPdf) return;
  if (/^(blob|data):/i.test(item.url) && /发货/.test(item.filename || '')) return; // 自己生成的文件
  const platform = detectPlatform(item.referrer) || detectPlatform(item.finalUrl || item.url);
  if (!platform && !running) return;
  const src = item.finalUrl || item.url;
  if (!/^https?:/i.test(src)) {
    if (running) return; // 一键运行时由批次页直接读取下载好的文件
    await note(`${name}：这个面单是浏览器内部生成的，无法自动抓取，请在批次页手动拖入。`);
    return;
  }
  try {
    const r = await fetch(src, { credentials: 'include' });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!isPdfBytes(bytes)) throw new Error('不是 PDF');
    const poolItem = await addToPool({ platform, filename: name, blob: new Blob([bytes], { type: 'application/pdf' }) });
    if (running) return;
    const target = await autoAssign(poolItem);
    await note(target
      ? `已自动把面单 ${name} 配给 ${target.title || target.orderId}`
      : `已截获面单 ${name}，请在批次页分配给对应订单。`);
  } catch (e) {
    await note(`${name}：自动抓取失败（${e.message}），请在批次页手动拖入。`);
  }
});

async function note(message) {
  await chrome.storage.local.set({ lastNote: { message, at: Date.now() } });
}

// ② 批量扫描：逐个在后台标签页打开订单详情，读取后关闭
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'scan') {
    scan(msg.links);
    sendResponse({ ok: true });
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitComplete(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 30000);
    function listener(id, info) { if (id === tabId && info.status === 'complete') done(); }
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function scan(links) {
  const status = { running: true, total: links.length, done: 0, added: 0, errors: [] };
  await chrome.storage.local.set({ scanStatus: status });
  for (const url of links) {
    let tabId;
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
      await waitComplete(tabId);
      await sleep(3000); // 等单页应用把内容渲染出来
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractOrderFromPage });
      if (!result || !result.title) throw new Error('没读到商品名');
      const { isNew } = await addOrder(result);
      if (isNew) status.added++;
    } catch (e) {
      status.errors.push(`${url}：${e.message}`);
    } finally {
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      status.done++;
      await chrome.storage.local.set({ scanStatus: status });
    }
  }
  status.running = false;
  await chrome.storage.local.set({ scanStatus: status });
}
