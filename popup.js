import { extractOrderFromPage, collectOrderLinks, diagnosePage } from './lib/extract.js';
import { addOrder, getOrders, detectPlatform, getSettings, suggestSku, addToPool, autoAssign, isPdfBytes } from './lib/store.js';
import { PLATFORM_META } from './lib/report.js';

const $ = (s) => document.querySelector(s);
let tab;
let platform = '';

function say(msg, isErr = false) {
  const el = $('#status');
  el.textContent = msg;
  el.className = isErr ? 'status err' : 'status';
}

async function refreshCount() {
  const orders = await getOrders();
  $('#count').textContent = orders.length ? `批次中 ${orders.length} 行` : '批次为空';
}

async function init() {
  $('#ver').textContent = `V${chrome.runtime.getManifest().version}`;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  platform = detectPlatform(tab && tab.url);
  $('#platform').textContent = platform ? PLATFORM_META[platform].name : '非平台页面';
  if (!platform) {
    $('#btnRead').disabled = true;
    $('#btnScan').disabled = true;
  }
  await refreshCount();
}

function fillForm(d) {
  $('#form').hidden = false;
  $('#f-platform').value = d.platform && PLATFORM_META[d.platform] && d.platform !== 'other' ? d.platform : (platform || 'poshmark');
  $('#f-orderId').value = d.orderId || '';
  $('#f-title').value = d.title || '';
  $('#f-sku').value = d.sku || '';
  $('#f-qty').value = d.qty || 1;
  $('#f-last4').value = d.trackingLast4 || '';
  $('#f-imageUrl').value = d.imageUrl || '';
  $('#f-url').value = d.url || '';
  $('#preview').src = d.imageUrl || '';
}

$('#btnRead').addEventListener('click', async () => {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOrderFromPage });
    if (!result.sku) result.sku = await suggestSku(result.title);
    fillForm(result);
    const miss = [];
    if (!result.title) miss.push('商品名');
    if (!result.orderId) miss.push('订单号');
    if (!result.imageUrl) miss.push('图片');
    say(miss.length ? `没读到：${miss.join('、')}，请手动补上再加入。` : '请核对后点「加入今日批次」。', miss.length > 0);
  } catch (e) {
    say(`读取失败：${e.message}`, true);
  }
});

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const data = {
    platform: $('#f-platform').value,
    orderId: $('#f-orderId').value,
    title: $('#f-title').value,
    sku: $('#f-sku').value,
    qty: $('#f-qty').value,
    trackingLast4: $('#f-last4').value,
    imageUrl: $('#f-imageUrl').value,
    url: $('#f-url').value,
  };
  if (!data.title.trim()) { say('商品名不能为空。', true); return; }
  const { isNew } = await addOrder(data);
  say(isNew ? '已加入。接下来在这个订单页点平台的「打印面单」，下载的 PDF 会自动配对。' : '这个订单已在批次中，已更新。');
  await refreshCount();
});

$('#btnScan').addEventListener('click', async () => {
  const settings = await getSettings();
  const pattern = settings.patterns[platform];
  const [{ result: links }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: collectOrderLinks, args: [pattern],
  });
  if (!links.length) {
    say('本页没找到订单详情链接。请确认是在「待发货/已售」列表页；也可以在批次页的设置里调整链接规则。', true);
    return;
  }
  if (!confirm(`找到 ${links.length} 个订单，将逐个在后台打开读取（每个约 5 秒）。继续？`)) return;
  await chrome.runtime.sendMessage({ type: 'scan', links });
  say('已开始扫描，进度可在批次页查看。读完后记得到批次页逐行核对。');
});

$('#btnPdf').addEventListener('click', async () => {
  try {
    const r = await fetch(tab.url, { credentials: 'include' });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!isPdfBytes(bytes)) { say('当前标签页不是 PDF 文件。', true); return; }
    const p = detectPlatform(tab.url) || $('#f-platform').value || platform;
    const item = await addToPool({
      platform: p,
      filename: decodeURIComponent(tab.url.split('/').pop().split('?')[0] || 'label.pdf'),
      blob: new Blob([bytes], { type: 'application/pdf' }),
    });
    const target = await autoAssign(item);
    say(target ? `已作为面单配给：${target.title || target.orderId}` : '已存入「待分配面单」，请在批次页分配。');
  } catch (e) {
    say(`抓取失败：${e.message}。可以先下载这个 PDF，再拖进批次页。`, true);
  }
});

$('#btnDiag').addEventListener('click', async () => {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: diagnosePage });
    let read = {};
    try { [{ result: read }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOrderFromPage }); } catch { /* ignore */ }
    const text = `${result}\n\n== 当前读取结果 ==\n${JSON.stringify({ ...read, url: undefined }, null, 1)}`;
    await navigator.clipboard.writeText(text);
    say(`已复制 ${text.length} 个字符。粘贴到对话里发给开发者即可（建议先扫一眼，有不想发的内容可以删掉）。`);
  } catch (e) {
    say(`诊断失败：${e.message}`, true);
  }
});

$('#btnBatch').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('batch.html') }));
$('#btnRunAll').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('batch.html#run') }));
for (const b of document.querySelectorAll('[data-scope]')) {
  b.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL(`batch.html#run=${b.dataset.scope}`) }));
}

init();
