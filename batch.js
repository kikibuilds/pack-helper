import {
  getOrders, updateOrder, removeOrder, duplicateOrder, clearBatch, getImage, getLabel, setLabel,
  getPool, assignPool, removeFromPool, getSettings, saveSettings, clearSent, unmarkSent, addManualOrder, AUTO_PLATFORMS, cleanOutDir,
} from './lib/store.js';
import { assignCodes, PLATFORM_META, shownOrderId } from './lib/report.js';
import { exportPackage } from './lib/package.js';
import { runAll, requestStop } from './lib/autorun.js';
import { sendPackageMail, checkMailer } from './lib/mail.js';
import { buildEmail, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY, EMAIL_FIELDS } from './lib/report.js';
import { ACTION_NAMES, takeNextJob, replyTo, updateRemoteLog } from './lib/remote.js';
import { idbPut, idbGet, idbDel } from './lib/db.js';
import { initI18n, setLang, getLang } from './lib/i18n.js';
import { validHeartbeatUrl, describeLoginResult } from './lib/health.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const objectUrls = [];
let skipNextRender = false;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function imgSrc(order, urls) {
  if (order.hasImage) {
    const blob = await getImage(order.id);
    if (blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
  }
  return order.imageUrl || '';
}

const groupKey = (o) => `${o.platform}|${o.orderId || o.id}`;

// 重绘可能同时发生好几次（连续更新多行时），只让最新的一次生效，避免旧数据盖住新数据
let renderSeq = 0;
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

async function render() {
  const mySeq = ++renderSeq;
  const all = await getOrders();
  const included = all.filter((o) => o.include !== false);
  const excluded = all.filter((o) => o.include === false);
  // 编号只给勾选了的（和发货里的编号一致）；没勾选的排在后面
  const rows = [...assignCodes(included), ...assignCodes(excluded).map((r) => ({ ...r, code: '—' }))];
  const incRows = rows.filter((r) => r.include !== false);
  const packages = new Set(incRows.map((r) => r.code)).size;
  const missing = new Set(incRows.filter((r) => !r.labelFile).map((r) => r.code)).size;
  $('#summary').textContent = all.length
    ? `已勾选 ${packages} 个包裹 · ${incRows.reduce((s, r) => s + r.qty, 0)} 件 · ${missing ? `${missing} 个缺面单` : '面单齐全'}`
    : '';
  $('#tableInfo').textContent = all.length
    ? `共 ${new Set(all.map(groupKey)).size} 单，已勾选 ${packages} 单${excluded.length ? `，未勾选 ${new Set(excluded.map(groupKey)).size} 单（灰色）` : ''}`
    : '';
  $('#checkAll').checked = all.length > 0 && excluded.length === 0;
  $('#empty').hidden = all.length > 0;

  const html = [];
  const newUrls = [];
  for (const r of rows) {
    const src = await imgSrc(r, newUrls);
    const first = r.itemIndex === 1;
    const on = r.include !== false;
    const badges = [
      r.prevPacked && !r.packedAt ? '<span class="badge">之前打包过<button class="unpack" data-act="unpack" title="去掉这个标记：当作没打包过的新订单">×</button></span>' : '',
      r.packedAt ? `<span class="badge done">已打包 ${esc(new Date(r.packedAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}<button class="unpack" data-act="unpack" title="去掉「已打包」标记：当作没打包过的新订单">×</button></span>` : '',
      r.source === 'manual' ? '<span class="badge" title="在批次页手动添加的，重新拉取时不会被删掉">手动添加</span>'
        : (r.edited || []).length ? '<span class="badge" title="你改过的内容，重新拉取时会保留">已手动修改</span>' : '',
    ].join(' ');
    // 面单状态：同一订单只看第一件
    let label = '<span class="muted">同上</span>';
    if (first) {
      const owner = r.labelOwnerId || (r.hasLabel ? r.id : '');
      label = owner
        ? `<span class="ok">✓ 已对应</span> <button class="small" data-act="view" data-owner="${owner}">打开</button>`
        : `<span class="miss">缺面单</span>${r.labelError ? `<span class="why">${esc(r.labelError)}</span>` : ''}`;
      label += ` <button class="small" data-act="pick">${owner ? '换一张' : '选择'}</button><input type="file" accept="application/pdf,image/png,image/jpeg" hidden>`;
      if (!owner && r.url) label += ` <a class="small" href="${esc(r.url)}" target="_blank">订单页↗</a>`;
    }
    html.push(`
      <tr data-id="${r.id}" data-group="${esc(groupKey(r))}" class="${on ? '' : 'off'}">
        <td class="inc">${first ? `<input type="checkbox" data-act="inc" ${on ? 'checked' : ''} title="勾选 = 这次打包下载">` : ''}</td>
        <td class="code" style="border-left:5px solid ${PLATFORM_META[r.platform].color}">${first ? esc(r.code) : '<span class="muted">同上</span>'}${first ? `<div>${badges}</div>` : ''}</td>
        <td>${esc(PLATFORM_META[r.platform].name)}</td>
        <td>${src ? `<img src="${esc(src)}" alt="">` : '<div class="noimg">无图</div>'}</td>
        <td><textarea data-f="title" rows="2">${esc(r.title)}</textarea></td>
        <td><input class="w-sku" data-f="sku" value="${esc(r.sku)}" placeholder="无"></td>
        <td><input class="w-qty" data-f="qty" type="number" min="1" value="${r.qty}"></td>
        <td>${shownOrderId(r.orderId) || !r.orderId ? `<input class="w-oid" data-f="orderId" value="${esc(r.orderId)}">` : '<span class="muted" title="手动添加的包裹，没有订单号">（无订单号）</span>'}</td>
        <td class="labelcell" data-drop="${r.id}">${label}</td>
        <td class="actions">
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" title="打开订单页">↗</a>` : ''}
          <button class="small" data-act="dup" title="多件订单：同一包裹再加一件商品">+件</button>
          <button class="small" data-act="del">删除</button>
        </td>
      </tr>`);
  }
  if (mySeq !== renderSeq) { newUrls.forEach((u) => URL.revokeObjectURL(u)); return; } // 已经有更新的重绘
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  objectUrls.push(...newUrls);
  $('#rows').innerHTML = html.join('');
  await renderPool(rows.filter((r) => r.include !== false));
}

async function renderPool(rows) {
  const pool = await getPool();
  $('#poolSection').hidden = pool.length === 0;
  const options = rows.filter((r) => r.itemIndex === 1)
    .map((r) => `<option value="${r.id}">${esc(r.code)} · ${esc(PLATFORM_META[r.platform].name)} · ${esc(r.title.slice(0, 40))}${r.labelFile ? '（已有面单）' : ''}</option>`)
    .join('');
  $('#pool').innerHTML = pool.map((p) => `
    <div class="poolitem" data-pool="${p.id}">
      <span>📄 ${esc(p.filename)}</span>
      <span class="muted">${esc(p.platform ? PLATFORM_META[p.platform].name : '')}</span>
      <select>${options}</select>
      <button class="small" data-act="assign">分配</button>
      <button class="small" data-act="poolDel">丢弃</button>
    </div>`).join('');
}

// —— 表格编辑 ——
$('#rows').addEventListener('change', async (ev) => {
  const el = ev.target;
  const tr = el.closest('tr');
  if (!tr) return;
  if (el.type === 'file') {
    if (el.files[0]) await attachFile(tr.dataset.id, el.files[0]);
    return;
  }
  const f = el.dataset.f;
  if (!f) return;
  const value = f === 'qty' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value.trim();
  skipNextRender = true; // 自己编辑时不重绘表格，避免打断输入
  await updateOrder(tr.dataset.id, { [f]: value }, { manual: true });
  if (f === 'orderId') await render(); // 订单号影响分组和编号
});

async function setInclude(group, on) {
  for (const o of await getOrders()) if (groupKey(o) === group) await updateOrder(o.id, { include: on });
}
$('#rows').addEventListener('change', async (ev) => {
  if (ev.target.dataset.act !== 'inc') return;
  ev.stopImmediatePropagation();
  await setInclude(ev.target.closest('tr').dataset.group, ev.target.checked);
}, true);
$('#checkAll').addEventListener('change', async (ev) => {
  for (const o of await getOrders()) await updateOrder(o.id, { include: ev.target.checked });
});

$('#rows').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  const act = btn.dataset.act;
  if (act === 'del' && confirm('从批次中删除这一行？')) { await removeOrder(id); await render(); }
  if (act === 'dup') { await duplicateOrder(id); await render(); }
  if (act === 'unpack') {
    const group = btn.closest('tr').dataset.group;
    if (!confirm('去掉「已打包」标记？\n去掉后这一单会自动勾选，下次拉取也不会再标「之前打包过」，打包时会再打进发货文件。')) return;
    const rows = (await getOrders()).filter((o) => groupKey(o) === group);
    for (const o of rows) await updateOrder(o.id, { packedAt: 0, prevPacked: false, include: true });
    await unmarkSent(rows);
    await render();
    showNote(`已去掉「已打包」标记（${rows.length} 行），现在已勾选。`);
  }
  if (act === 'pick') btn.parentElement.querySelector('input[type=file]').click();
  if (act === 'view') {
    const blob = await getLabel(btn.dataset.owner || id);
    if (blob) window.open(URL.createObjectURL(blob), '_blank');
  }
});

async function attachFile(orderId, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ? 'application/pdf'
    : (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'image/png' : (bytes[0] === 0xff && bytes[1] === 0xd8) ? 'image/jpeg' : '';
  if (!type) { alert('这不是 PDF 或图片文件。'); return; }
  await setLabel(orderId, new Blob([bytes], { type }));
  await render();
}

// 拖放 PDF 到面单格
$('#rows').addEventListener('dragover', (ev) => {
  const cell = ev.target.closest('[data-drop]');
  if (!cell) return;
  ev.preventDefault();
  cell.classList.add('drag');
});
$('#rows').addEventListener('dragleave', (ev) => {
  const cell = ev.target.closest('[data-drop]');
  if (cell) cell.classList.remove('drag');
});
$('#rows').addEventListener('drop', async (ev) => {
  const cell = ev.target.closest('[data-drop]');
  if (!cell) return;
  ev.preventDefault();
  cell.classList.remove('drag');
  const file = ev.dataTransfer.files[0];
  if (file) await attachFile(cell.dataset.drop, file);
});

// —— 待分配面单 ——
$('#pool').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const item = btn.closest('[data-pool]');
  if (btn.dataset.act === 'assign') await assignPool(item.dataset.pool, item.querySelector('select').value);
  if (btn.dataset.act === 'poolDel') await removeFromPool(item.dataset.pool);
  await render();
});

// —— 打包下载 / 打包并发邮件：只打包勾选的订单 ——
async function doPack({ sendTo = [], sendFrom = '', sendBcc = [] } = {}) {
  const all = await getOrders();
  const orders = all.filter((o) => o.include !== false);
  if (!orders.length) { alert(all.length ? '没有勾选任何订单。' : '批次是空的。'); return; }
  const rows = assignCodes(orders);
  const packages = new Set(rows.map((r) => r.code)).size;
  const missing = [...new Set(rows.filter((r) => !r.labelFile).map((r) => r.code))];
  const prev = [...new Set(rows.filter((r) => r.prevPacked || r.packedAt).map((r) => r.code))];
  const lines = [`将打包 ${packages} 个包裹、${rows.reduce((s, r) => s + r.qty, 0)} 件商品。`];
  if (sendTo.length) lines.push(`打包后用 ${sendFrom} 发邮件给：${sendTo.join('、')}${sendBcc.length ? `（密送 ${sendBcc.join('、')}）` : ''}`);
  if (missing.length) lines.push(`⚠ ${missing.join('、')} 还没有面单（打包清单上会标红，提醒员工先不要发）。`);
  if (prev.length) lines.push(`⚠ ${prev.join('、')} 之前已经打包过，确定要再打包一次吗？`);
  const noTitle = rows.filter((r) => !r.title).map((r) => r.code);
  if (noTitle.length) lines.push(`⚠ ${noTitle.join('、')} 没有商品名。`);
  if (!confirm(lines.join('\n') + `\n\n继续${sendTo.length ? '打包并发邮件' : '打包下载'}吗？`)) return;
  setBusy(true);
  if (sendTo.length) mailStatus('packing');
  try {
    const { lastScan } = await chrome.storage.local.get('lastScan');
    const res = await exportPackage({
      orders, trigger: lastScan ? '拉取后手动打包' : '批次页手动打包',
      startedAt: lastScan ? new Date(lastScan.startedAt) : new Date(),
      extra: lastScan ? lastScan.extra : {},
      sendTo,
      sendFrom,
    });
    // 打进包里的行保留在表格里，标「已打包」并取消勾选，避免下次重复打包
    const now = Date.now();
    for (const id of res.sentIds) await updateOrder(id, { packedAt: now, include: false, prevPacked: true });
    showNote(`已打包：${res.folder}/（发货 + 报告）。${res.summary}。`, res.status === 'WARN');
    if (sendTo.length) {
      const tpl = await getSettings();
      const mail = buildEmail(res.rows, res.zipName, res.date, { subject: tpl.emailSubject, body: tpl.emailBody });
      pendingMail = {
        from: sendFrom,
        to: sendTo,
        bcc: sendBcc,
        subject: mail.subject,
        body: mail.body,
        zipName: res.zipName,
        zipBytes: res.zipBytes,
      };
      await sendPending();
    }
  } catch (e) {
    if (sendTo.length) mailStatus('fail', `打包这一步就出错了：${e.message}`, { stage: 'packing' });
    showNote(`打包失败：${e.message}`, true);
  } finally {
    setBusy(false);
    await render();
    await renderLastRun();
  }
}
// —— 发邮件的状态：正在打包 → 正在发送 → 发送成功 / 发送失败（附错误信息） ——
let pendingMail = null; // 最近一次要发的邮件（发送失败时可以「重新发送」，不用重新打包）
function mailStatus(state, detail = '', { stage = 'sending' } = {}) {
  const box = $('#mailStatus');
  box.hidden = false;
  const order = ['packing', 'sending', 'result'];
  const cur = state === 'packing' ? 0 : state === 'sending' ? 1 : 2;
  const failAt = state === 'fail' ? (stage === 'packing' ? 0 : 1) : -1;
  const labels = ['① 正在打包', '② 正在发送邮件', state === 'ok' ? '③ 发送成功 ✅' : state === 'fail' ? '③ 发送失败 ❌' : '③ 完成'];
  const steps = order.map((_, i) => {
    let cls = 'step';
    if (failAt >= 0) cls += i < failAt ? ' done' : i === failAt || i === 2 ? ' fail' : '';
    else if (i < cur || state === 'ok') cls += ' done';
    else if (i === cur) cls += ' active';
    return `<span class="${cls}">${labels[i]}${i === cur && (state === 'packing' || state === 'sending') ? '…' : ''}</span>`;
  }).join('<span class="muted">→</span>');
  box.className = `mailstatus${state === 'ok' ? ' ok' : state === 'fail' ? ' fail' : ''}`;
  box.innerHTML = `<div class="steps">${steps}</div>${detail ? (state === 'fail'
    ? `<div class="detail">失败原因：</div><div class="err">${esc(detail)}</div>`
    : `<div class="detail">${esc(detail)}</div>`) : ''}${state === 'fail' && pendingMail ? '<button id="btnResend" class="go">↻ 重新发送</button> <span class="muted">（用刚才打好的同一个发货文件，不会重新打包）</span>' : ''}`;
  const rb = $('#btnResend');
  if (rb) rb.addEventListener('click', () => sendPending());
  // 页面往下翻着的时候也要看得到状态
  const top = box.getBoundingClientRect().top;
  if (top < 90 || top > window.innerHeight - 80) window.scrollTo({ top: window.scrollY + top - 100, behavior: 'smooth' });
}
async function sendPending() {
  if (!pendingMail) return;
  const m = pendingMail;
  mailStatus('sending', `从 ${m.from} 发给 ${m.to.join('、')}${m.bcc && m.bcc.length ? `（密送 ${m.bcc.join('、')}）` : ''}，附件 ${m.zipName}（${(m.zipBytes ? m.zipBytes.length / 1024 / 1024 : 0).toFixed(1)} MB）。网络不好时会自动重试，最多约 2 分钟，请别关这个页面。`);
  setBusy(true);
  const res = await sendPackageMail(m);
  setBusy(false);
  if (res.ok) {
    mailStatus('ok', `${res.message}（${new Date().toLocaleTimeString('zh-CN', { hour12: false })}）。附件：${m.zipName}`);
    await chrome.storage.local.set({ lastMail: { at: Date.now(), ok: true, to: m.to, from: m.from, zipName: m.zipName } });
  } else {
    mailStatus('fail', res.error || '未知错误');
    await chrome.storage.local.set({ lastMail: { at: Date.now(), ok: false, error: res.error, to: m.to, from: m.from, zipName: m.zipName } });
  }
}

$('#btnResetMailTpl').addEventListener('click', () => {
  $('#emailSubject').value = DEFAULT_EMAIL_SUBJECT;
  $('#emailBody').value = DEFAULT_EMAIL_BODY;
  showNote('已恢复默认的邮件标题和正文，点「保存邮件设置」后生效。');
});
function previewMail() {
  const demo = [
    { code: 'P01', sku: 'MXM-AP-05', qty: 1, title: 'Tiny Bartholomew Bear outfit - Floppy Puppy Hood', labelFile: 'x' },
    { code: 'P01', sku: 'FX-32-6IN', qty: 1, title: 'Grey Cat T-shirt', labelFile: 'x' },
    { code: 'D01', sku: 'MXM-27', qty: 1, title: 'Crochet Outfit – Red swimsuit', labelFile: 'x' },
  ];
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const m = buildEmail(demo, `发货_${date}_090000.zip`, date, { subject: $('#emailSubject').value, body: $('#emailBody').value });
  $('#mailPreview').textContent = `标题：${m.subject}\n\n${m.body}`;
}
$('#emailSubject').addEventListener('input', previewMail);
$('#emailBody').addEventListener('input', previewMail);

$('#btnTestMail').addEventListener('click', async () => {
  const box = $('#testMailResult');
  box.hidden = false;
  box.className = 'mailstatus';
  box.textContent = '正在检查邮件程序…';
  const from = $('#emailFrom').value.trim();
  const res = await checkMailer(from);
  box.className = `mailstatus ${res.ok ? 'ok' : 'fail'}`;
  box.innerHTML = res.ok ? `✅ ${esc(res.message)}` : `❌ 检查没通过：<div class="err">${esc(res.error)}</div>`;
});

$('#btnZip').addEventListener('click', () => doPack());
$('#btnMail').addEventListener('click', async () => {
  const to = $('#mailTo').value;
  if (!to) {
    alert('还没有收件人。请在页面下方「设置 → 邮件收件人」里添加邮箱。');
    $('#settings').open = true;
    $('#emailList').focus();
    return;
  }
  const st = await getSettings();
  if (!st.emailFrom) {
    alert('还没有发件邮箱。请在页面下方「设置 → 邮件」里填写。');
    $('#settings').open = true;
    $('#emailFrom').focus();
    return;
  }
  const sendTo = to === '__all__' ? st.emailTo : [to];
  const sendBcc = (st.emailBcc || []).filter((b) => !sendTo.some((t) => t.toLowerCase() === b.toLowerCase()));
  await doPack({ sendTo, sendFrom: st.emailFrom, sendBcc });
});

// —— 邮件收件人 ——
const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$/;
async function renderEmails() {
  const s = await getSettings();
  const list = s.emailTo || [];
  $('#emailList').value = list.join('\n');
  $('#emailFrom').value = s.emailFrom || '';
  $('#emailBcc').value = (s.emailBcc || []).join(', ');
  $('#emailSubject').value = s.emailSubject || DEFAULT_EMAIL_SUBJECT;
  $('#emailBody').value = s.emailBody || DEFAULT_EMAIL_BODY;
  $('#emailFields').innerHTML = EMAIL_FIELDS.map(([k, d]) => `<li><code>${esc(k)}</code> ${esc(d)}</li>`).join('');
  previewMail();
  let last = '';
  try { last = localStorage.getItem('mailTo') || ''; } catch { /* ignore */ }
  $('#mailTo').innerHTML = list.length
    ? list.map((a) => `<option value="${esc(a)}">发给 ${esc(a)}</option>`).join('') + (list.length > 1 ? '<option value="__all__">发给以上全部</option>' : '')
    : '<option value="">（先在设置里添加邮箱）</option>';
  if (last && [...$('#mailTo').options].some((o) => o.value === last)) $('#mailTo').value = last;
}
$('#mailTo').addEventListener('change', () => { try { localStorage.setItem('mailTo', $('#mailTo').value); } catch { /* ignore */ } });
$('#btnSaveEmails').addEventListener('click', async () => {
  const list = [...new Set($('#emailList').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  const bad = list.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) { alert(`这些不是有效的邮箱：${bad.join('、')}`); return; }
  if (list.length > 5) { alert('最多 5 个收件人。'); return; }
  const from = $('#emailFrom').value.trim();
  if (!EMAIL_RE.test(from)) { alert('请填写有效的发件邮箱（Gmail）。'); return; }
  const bcc = [...new Set($('#emailBcc').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  const badBcc = bcc.filter((a) => !EMAIL_RE.test(a));
  if (badBcc.length) { alert(`密送里这些不是有效的邮箱：${badBcc.join('、')}`); return; }
  if (bcc.length > 3) { alert('密送最多 3 个。'); return; }
  const s = await getSettings();
  const changedFrom = from !== s.emailFrom;
  // 和默认一样就存空，以后默认更新时会自动跟着变
  const subj = $('#emailSubject').value.trim();
  const body = $('#emailBody').value.replace(/\s+$/, '');
  await saveSettings({ ...s, emailTo: list, emailFrom: from, emailBcc: bcc,
    emailSubject: subj === DEFAULT_EMAIL_SUBJECT ? '' : subj,
    emailBody: body.trim() === DEFAULT_EMAIL_BODY ? '' : body });
  await renderEmails();
  await renderRemote();
  showNote(`已保存：发件邮箱 ${from}，${list.length} 个收件人${bcc.length ? `，每封都密送 ${bcc.join('、')}` : ''}。${changedFrom ? '发件邮箱换了的话，记得在 Mac 上为它运行一次 install.sh 保存密码。' : ''}`);
});

// —— 一键全自动运行 ——
function setBusy(busy, running = false) {
  for (const id of ['#btnRun', '#btnZip', '#btnMail', '#mailTo', '#btnClear', '#runScope']) $(id).disabled = busy;
  $('#btnStop').disabled = !running;
  $('#btnStop').textContent = '■ 停止';
}

$('#btnStop').addEventListener('click', () => {
  requestStop();
  $('#btnStop').disabled = true;
  $('#btnStop').textContent = '正在停止…';
  $('#runMsg').textContent = '正在停止，关闭后台打开的标签页…';
});

// 下拉菜单：所有平台 / 只拉某一个平台（记住上次的选择）
const scopeNames = { all: '所有平台', poshmark: 'Poshmark', mercari: 'Mercari', depop: 'Depop' };
try { const v = localStorage.getItem('runScope'); if (v && scopeNames[v]) $('#runScope').value = v; } catch { /* ignore */ }
function updateRunLabel() {
  const v = $('#runScope').value;
  $('#btnRun').textContent = v === 'all' ? '▶ 一键拉取订单' : `▶ 拉取 ${scopeNames[v]} 订单`;
  try { localStorage.setItem('runScope', v); } catch { /* ignore */ }
}
$('#runScope').addEventListener('change', updateRunLabel);
updateRunLabel();

async function startRun(scope) {
  const v = typeof scope === 'string' && scopeNames[scope] ? scope : $('#runScope').value;
  $('#runScope').value = v; updateRunLabel();
  const platforms = v === 'all' ? null : [v];
  const what = v === 'all' ? 'Poshmark、Mercari、Depop' : scopeNames[v];
  if (!confirm(`将打开 ${what} 的待发货列表，把订单和面单拉到这个页面的表格里（不会自动打包）。\n检查无误后再点「打包下载」。\n运行期间请保持本页打开。开始吗？`)) return;
  setBusy(true, true);
  $('#runBox').hidden = false;
  $('#note').hidden = true;
  const onProgress = (msg) => { if (!$('#btnStop').disabled) $('#runMsg').textContent = msg; };
  try {
    let res;
    try {
      res = await runAll(onProgress, { platforms });
    } catch (e) {
      if (e.code !== 'BUSY') throw e;
      // 上次运行可能因为关掉页面而没有正常结束
      if (!confirm('显示还有一次运行没有结束（可能是上次运行时关掉了页面）。\n确定没有其他批次页在运行的话，点「确定」强制重新开始。')) {
        showNote('已取消。', true);
        return;
      }
      res = await runAll(onProgress, { force: true, platforms });
    }
    if (res.stopped) {
      showNote('已停止。已经读取的订单保留在下方表格里；检查后可以直接点「打包下载」。', true);
    } else {
      const bad = res.missing || res.problems;
      if (!res.packages) { showNote(`拉取完成：没有需要打包的新订单${res.problems ? `（${res.problems} 个问题见下方「本次拉取情况」）` : ''}。之前打包过的订单在表格里标「已打包」、不勾选。`, !!res.problems); return; }
      showNote(`拉取完成：勾选了 ${res.packages} 个包裹${res.missing ? `，其中 ${res.missing} 个缺面单` : '，面单齐全'}${res.problems ? `，${res.problems} 个问题见下方「本次拉取情况」` : ''}。请检查下面的表格，确认后点「⬇ 打包下载」。`, !!bad);
    }
  } catch (e) {
    showNote(`运行中断：${e.message}`, true);
  } finally {
    $('#runBox').hidden = true;
    setBusy(false);
    await render();
    await renderLastRun();
    await renderScanSummary();
  }
}
$('#btnRun').addEventListener('click', () => startRun());

// —— 本次拉取情况（原来只在报告里，现在直接显示在页面上） ——
async function renderScanSummary() {
  const { lastScan } = await chrome.storage.local.get('lastScan');
  const box = $('#scanSummary');
  if (!lastScan) { box.hidden = true; return; }
  const x = lastScan.extra || {};
  const name = (p) => (PLATFORM_META[p] || PLATFORM_META.other).name;
  const plat = Object.entries(x.platforms || {}).map(([p, st]) =>
    `<li>${esc(name(p))}：列表中 ${st.found} 单，新加入 ${st.added}，已寄出跳过 ${st.shipped || 0}，之前打包过 ${st.skipped}，失败 ${st.failed}</li>`).join('');
  const bad = [
    ...(x.loginIssues || []).map((p) => `${name(p)} 需要重新登录`),
    ...(x.failures || []),
    ...(x.warnings || []),
  ];
  const short = (t) => String(t).split('\n')[0];
  box.hidden = false;
  box.innerHTML = `
    <h2>本次拉取情况 · ${esc(new Date(lastScan.at).toLocaleString('zh-CN', { hour12: false }))}</h2>
    <ul>${plat}</ul>
    ${bad.length ? `<div class="bad">需要注意：</div><ul>${bad.map((b) => `<li class="bad">${esc(short(b))}</li>`).join('')}</ul>` : ''}
    ${(x.failures || []).concat(x.labelFailures || [], x.samples || []).some((t) => /【诊断】/.test(t))
      ? `<details><summary>详细诊断（发给开发者用）</summary><pre>${esc([...(x.failures || []), ...(x.labelFailures || []), ...(x.samples || [])].join('\n\n'))}</pre></details>` : ''}`;
}

async function renderLastRun() {
  const { lastRun } = await chrome.storage.local.get('lastRun');
  if (!lastRun) { $('#lastRun').innerHTML = ''; return; }
  const when = new Date(lastRun.at).toLocaleString('zh-CN', { hour12: false });
  const list = lastRun.packaged || [];
  const codes = [...new Set(list.map((r) => r.code))];
  // 商品名用批次里的最新值（之前读错、后来重新拉取更正过的会跟着更新）
  const cur = new Map((await getOrders()).map((o) => [`${o.platform}|${o.orderId}|${o.itemIndex || 0}`, o]));
  const seen = new Set();
  $('#lastRun').innerHTML = `
    <div>上次生成：${esc(when)} · ${esc(lastRun.summary)}${lastRun.folder ? ` · 文件在 ${esc(lastRun.folder)}/` : ''}</div>
    ${list.length ? `<details class="packaged"><summary>上次打包下载了 ${codes.length} 个包裹（表格里标「已打包」）</summary>
      <table><tbody>${list.map((r, i) => {
        const o = cur.get(`${r.platform}|${r.orderId}|${r.itemIndex || 0}`) || (r.itemIndex ? null : cur.get(`${r.platform}|${r.orderId}|0`));
        const k = `${r.platform}|${r.orderId}`;
        const firstOfOrder = !seen.has(k); seen.add(k);
        return `<tr><td class="code">${esc(r.code)}</td><td>${esc(PLATFORM_META[r.platform] ? PLATFORM_META[r.platform].name : r.platform)}</td><td>${esc((o && o.title) || r.title)}</td><td>${esc((o && o.sku) || r.sku || '')}</td><td>× ${r.qty}</td>
          <td>${firstOfOrder && r.orderId ? `<button class="small" data-unpack-last="${i}" title="去掉「已打包」标记：当作没打包过的新订单">× 去掉标记</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
    </details>` : ''}`;
}

$('#btnClear').addEventListener('click', async () => {
  if (!confirm('清空所有订单、图片和面单？此操作不能撤销。')) return;
  await clearBatch();
  await render();
});

function showNote(msg, warn = false) {
  $('#note').hidden = false;
  $('#note').className = warn ? 'note warn' : 'note';
  $('#note').textContent = msg;
}

// —— 设置 ——
async function renderSettings() {
  const s = await getSettings();
  $('#autoCapture').checked = s.autoCapture;
  $('#outDir').value = s.outDir;
  $('#outDirShow').textContent = s.outDir;
  $('#listUrls').innerHTML = AUTO_PLATFORMS.map((k) => `
    <div class="listrow">
      <span>${esc(PLATFORM_META[k].name)}</span>
      <input data-u="${k}" value="${esc(s.listUrls[k] || '')}" placeholder="列表页地址，留空 = 跳过">
      <input data-f="${k}" class="filter" value="${esc(s.listFilters[k] || '')}" placeholder="先点的按钮（可空）">
    </div>`).join('');
  $('#patterns').innerHTML = Object.entries(s.patterns).filter(([k]) => AUTO_PLATFORMS.includes(k)).map(([k, v]) => `
    <div class="patrow"><span>${esc(PLATFORM_META[k].name)}</span><input data-p="${k}" value="${esc(v)}"></div>`).join('');
}
$('#btnSaveSettings').addEventListener('click', async () => {
  const patterns = {};
  for (const el of document.querySelectorAll('[data-p]')) {
    try { new RegExp(el.value); } catch { alert(`${el.dataset.p} 的规则不是合法的正则表达式`); return; }
    patterns[el.dataset.p] = el.value;
  }
  const listFilters = {};
  for (const el of document.querySelectorAll('#listUrls [data-f]')) listFilters[el.dataset.f] = el.value.trim();
  const listUrls = {};
  for (const el of document.querySelectorAll('[data-u]')) {
    const v = el.value.trim();
    if (v && !/^https:\/\//.test(v)) { alert(`${PLATFORM_META[el.dataset.u].name} 的列表地址应以 https:// 开头`); return; }
    listUrls[el.dataset.u] = v;
  }
  const cur = await getSettings(); // 保留收件人等其他设置
  const outDir = cleanOutDir($('#outDir').value);
  await saveSettings({ ...cur, autoCapture: $('#autoCapture').checked, patterns, listUrls, listFilters, outDir });
  $('#outDir').value = outDir;
  $('#outDirShow').textContent = outDir;
  showNote('设置已保存。');
});

$('#lastRun').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-unpack-last]');
  if (!btn) return;
  const { lastRun } = await chrome.storage.local.get('lastRun');
  const r = lastRun && (lastRun.packaged || [])[Number(btn.dataset.unpackLast)];
  if (!r) return;
  if (!confirm(`去掉 ${r.code}（订单 ${r.orderId}）的「已打包」标记？\n去掉后下次拉取不会再标「之前打包过」，会当作新订单自动勾选。`)) return;
  const same = (o) => o.platform === r.platform && o.orderId === r.orderId;
  await unmarkSent([r]);
  for (const o of (await getOrders()).filter(same)) await updateOrder(o.id, { packedAt: 0, prevPacked: false, include: true });
  lastRun.packaged = lastRun.packaged.filter((x) => !same(x));
  await chrome.storage.local.set({ lastRun });
  await render();
  await renderLastRun();
  showNote(`已去掉 ${r.code}（订单 ${r.orderId}）的「已打包」标记。`);
});

$('#btnClearSent').addEventListener('click', async () => {
  if (!confirm('清除后，之前打包过、但平台上还显示待发货的订单会再次进入发货文件。确定吗？')) return;
  await clearSent();
  showNote('已清除已打包记录。');
});

// —— 后台消息：截获面单、扫描进度 ——
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastNote && changes.lastNote.newValue) showNote(changes.lastNote.newValue.message);
  if (changes.scanStatus) showScan(changes.scanStatus.newValue);
  if (changes.remoteLog || changes.remoteLastPoll) renderRemoteLog();
  if (changes.orders && skipNextRender && !changes.labelPool) { skipNextRender = false; return; }
  if (changes.orders || changes.labelPool) { scheduleRender(); if (changes.orders) renderManualPkgs(); }
});

// ===================== 远程指令（邮件触发） =====================
const PNAME = { poshmark: 'Poshmark', mercari: 'Mercari', depop: 'Depop' };
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });

async function renderRemote() {
  const s = await getSettings();
  const r = s.remote;
  $('#remoteEnabled').checked = !!r.enabled;
  $('#remoteAllow').value = (r.allow || []).join('\n');
  $('#remoteSecret').value = r.secret || '';
  $('#remoteInterval').value = String(r.intervalMin || 2);
  $('#remoteIncludePacked').checked = r.includePacked !== false;
  const list = s.emailTo || [];
  $('#remoteSendTo').innerHTML = (list.length
    ? list.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('') + (list.length > 1 ? '<option value="__all__">以上全部收件人</option>' : '')
    : '<option value="">（先在上面「邮件」里添加收件人）</option>');
  if (r.sendTo && [...$('#remoteSendTo').options].some((o) => o.value === r.sendTo)) $('#remoteSendTo').value = r.sendTo;
  renderRemoteHelp();
  await renderRemoteLog();
}
function renderRemoteHelp() {
  // 英文界面显示英文指令词（邮件程序中英文都认）
  const en = getLang() === 'en';
  const k = $('#remoteSecret').value.trim() || (en ? 'PASSPHRASE' : '暗号');
  const w = en ? { pack: 'pack', pull: 'pull', status: 'status', resend: 'resend' } : { pack: '打包', pull: '拉取', status: '状态', resend: '重发' };
  $('#remoteHelp').innerHTML = [
    [`${k} ${w.pack}`, ACTION_NAMES.pack + '：每次都先把全部平台重新拉一遍（最新状态），再打包、发邮件'],
    [`${k} ${w.pull}`, ACTION_NAMES.pull + '：拉取全部平台，回信列出会打包哪些订单、缺不缺面单、有没有平台要重新登录'],
    [`${k} ${w.status}`, '回信告诉你电脑、平台登录、上次运行的情况'],
    [`${k} ${w.resend}`, ACTION_NAMES.resend],
  ].map(([a, b]) => `<li><code>${esc(a)}</code> ${esc(b)}</li>`).join('')
    + '<li>每封指令都会先回一封「收到」，做完再回一封结果；3 小时以前发的指令不会执行。</li>';
}
$('#remoteSecret').addEventListener('input', renderRemoteHelp);
$('#btnGenSecret').addEventListener('click', () => {
  const words = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  $('#remoteSecret').value = `PH-${[...a].map((x) => words[x % words.length]).join('')}`;
  renderRemoteHelp();
});
async function renderRemoteLog() {
  const { remoteLog = [], remoteLastPoll } = await chrome.storage.local.get(['remoteLog', 'remoteLastPoll']);
  $('#remoteLastPoll').textContent = remoteLastPoll
    ? `上次检查收件箱：${fmtTime(remoteLastPoll.at)}${remoteLastPoll.ok ? '，正常' : `，失败：${remoteLastPoll.error}`}`
    : '';
  $('#remoteLog').innerHTML = remoteLog.length
    ? `<table><tr><th>时间</th><th>发件人</th><th>指令</th><th>结果</th></tr>${remoteLog.map((e) => `<tr>
        <td>${esc(fmtTime(e.at))}</td><td>${esc(e.from)}</td>
        <td>${esc(ACTION_NAMES[e.action] || e.action)}<br><span class="muted">${esc(e.subject)}</span></td>
        <td class="st-${esc(e.state)}">${esc(e.result)}</td></tr>`).join('')}</table>`
    : '<p class="muted">还没有收到过远程指令。</p>';
}
/** 保存远程设置。开启状态下先检查每一项都填好了，有缺的就提示、不保存（返回 false）。 */
async function saveRemote() {
  const allow = [...new Set($('#remoteAllow').value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const secret = $('#remoteSecret').value.trim();
  const enabled = $('#remoteEnabled').checked;
  const sendTo = $('#remoteSendTo').value;
  const s = await getSettings();
  const bad = allow.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) { alert(`这些不是有效的邮箱：${bad.join('、')}`); return false; }
  if (enabled) {
    const missing = [];
    if (!s.emailFrom || !EMAIL_RE.test(s.emailFrom)) missing.push('· 上面「邮件」里的发件邮箱（填好后点「保存邮件设置」）');
    if (!allow.length) missing.push('· 允许的邮箱（至少一个）');
    if (secret.length < 4) missing.push('· 暗号（至少 4 个字，可以点「随机生成」）');
    if (!sendTo) missing.push('· 打包后发给（先在上面「邮件」里添加收件人并保存，再在这里选）');
    if (missing.length) { alert(`还不能开启远程指令，下面这些没填好：\n\n${missing.join('\n')}`); return false; }
    // 纯字母 / 纯中文、又比较短的暗号，很容易在普通邮件标题里碰巧出现（比如 SHIP 会匹配 Shipping、Shipped）
    if (/^([a-z]+|[一-鿿]+)$/i.test(secret) && secret.length < 8
      && !confirm(`暗号「${secret}」容易在普通邮件标题里碰巧出现（不分大小写，标题里包含就算，比如 SHIP 会匹配 Shipping / Shipped），可能误触发打包。\n\n建议点「随机生成」换一个。确定还是用这个吗？`)) return false;
  }
  await saveSettings({ ...s, remote: { ...s.remote, enabled, allow, secret, sendTo, intervalMin: Number($('#remoteInterval').value) || 2, includePacked: $('#remoteIncludePacked').checked } });
  await renderRemote();
  showNote(enabled
    ? `远程指令已开启并保存：每 ${$('#remoteInterval').value} 分钟查一次收件箱，打包后发给 ${sendTo === '__all__' ? '全部收件人' : sendTo}。可以用 ${allow[0]} 发一封标题为「${secret} 状态」的邮件到 ${s.emailFrom} 试试。`
    : '远程指令已关闭（设置已保存）。');
  return true;
}
$('#btnSaveRemote').addEventListener('click', () => saveRemote());
// 勾「开启远程指令」就自动检查并保存；有没填好的，提示后自动取消勾选
$('#remoteEnabled').addEventListener('change', async (ev) => {
  const ok = await saveRemote();
  if (!ok && ev.target.checked) ev.target.checked = false;
});
$('#btnPollNow').addEventListener('click', async () => {
  const box = $('#remotePollResult');
  box.hidden = false; box.className = 'mailstatus'; box.textContent = '正在检查收件箱…（用的是已保存的设置，改了设置请先保存）';
  const res = await chrome.runtime.sendMessage({ type: 'remotePollNow' });
  box.className = `mailstatus ${res && res.ok ? 'ok' : 'fail'}`;
  if (!res || !res.ok) box.innerHTML = `❌ 检查失败：<div class="err">${esc((res && res.error) || '没有回应')}</div>`;
  else if (res.skipped) box.textContent = `ℹ ${res.skipped}`;
  else box.textContent = `✅ 收件箱检查正常：新指令 ${res.commands} 个${res.rejected ? `，忽略 ${res.rejected} 个（见下方记录）` : ''}。`;
  await renderRemoteLog();
});

// ===================== 掉线报警（心跳）和每日登录检查 =====================
async function renderHealth() {
  const { health: h } = await getSettings();
  $('#hbEnabled').checked = !!h.heartbeatEnabled;
  $('#hbUrl').value = h.heartbeatUrl || '';
  $('#hbMin').value = String(h.heartbeatMin || 5);
  $('#lcEnabled').checked = !!h.loginCheckEnabled;
  $('#lcTime').value = h.loginCheckTime || '08:00';
  $('#lcNotify').value = h.loginCheckNotify || '';
  await renderHealthLast();
}
async function renderHealthLast() {
  const { heartbeatLast: hb, loginCheckLast: lc } = await chrome.storage.local.get(['heartbeatLast', 'loginCheckLast']);
  const parts = [];
  if (hb) parts.push(`上次报平安：${fmtTime(hb.at)}，${hb.ok ? '正常' : `失败：${hb.error}`}`);
  if (lc) parts.push(`上次登录检查：${fmtTime(lc.at)}，${(lc.results || []).map(describeLoginResult).join('；')}`);
  $('#healthLast').textContent = parts.join('　');
}
async function saveHealth() {
  const s = await getSettings();
  const heartbeatEnabled = $('#hbEnabled').checked;
  const heartbeatUrl = $('#hbUrl').value.trim();
  const loginCheckEnabled = $('#lcEnabled').checked;
  const loginCheckNotify = $('#lcNotify').value.trim().toLowerCase();
  const missing = [];
  if (heartbeatEnabled && !validHeartbeatUrl(heartbeatUrl)) missing.push('· 心跳网址：监控服务给的网址，以 https:// 开头');
  if (loginCheckNotify && !EMAIL_RE.test(loginCheckNotify)) missing.push('· 提醒发给：不是有效的邮箱');
  if (loginCheckEnabled && loginCheckNotify && (!s.emailFrom || !EMAIL_RE.test(s.emailFrom))) missing.push('· 上面「邮件」里的发件邮箱（提醒邮件要用它发；填好后点「保存邮件设置」）');
  if (missing.length) { alert(`还不能保存，下面这些没填好：\n\n${missing.join('\n')}`); return false; }
  await saveSettings({ ...s, health: { ...s.health, heartbeatEnabled, heartbeatUrl, heartbeatMin: Number($('#hbMin').value) || 5, loginCheckEnabled, loginCheckTime: $('#lcTime').value || '08:00', loginCheckNotify } });
  await renderHealth();
  showNote([
    heartbeatEnabled ? `掉线报警已开启：每 ${$('#hbMin').value} 分钟报一次平安。` : '掉线报警已关闭。',
    loginCheckEnabled ? `每日登录检查已开启：每天 ${$('#lcTime').value}${loginCheckNotify ? `，需要重新登录时发邮件给 ${loginCheckNotify}` : '，只记录不发邮件'}。` : '每日登录检查已关闭。',
  ].join(''));
  return true;
}
$('#btnSaveHealth').addEventListener('click', () => saveHealth());
for (const id of ['#hbEnabled', '#lcEnabled']) {
  $(id).addEventListener('change', async (ev) => { const ok = await saveHealth(); if (!ok && ev.target.checked) ev.target.checked = false; });
}
async function healthAction(type, busyText) {
  const box = $('#healthResult');
  box.hidden = false; box.className = 'mailstatus'; box.textContent = busyText;
  const res = await chrome.runtime.sendMessage({ type });
  box.className = `mailstatus ${res && res.ok ? 'ok' : 'fail'}`;
  if (!res || (!res.ok && res.error)) box.innerHTML = `❌ 失败：<div class="err">${esc((res && res.error) || '没有回应')}</div>`;
  else if (res.skipped) box.textContent = `ℹ ${res.skipped}`;
  else if (type === 'heartbeatNow') box.textContent = `✅ 已报平安（监控服务返回 HTTP ${res.status}）。`;
  else {
    const mail = res.mail ? (res.mail.ok ? `；已发提醒邮件给 ${res.mail.to}` : `；提醒邮件发送失败：${res.mail.error}`) : '';
    box.textContent = `${(res.results || []).some((r) => r.loggedIn === false) ? '⚠' : '✅'} ${(res.results || []).map(describeLoginResult).join('；')}${mail}`;
  }
  await renderHealthLast();
}
$('#btnBeatNow').addEventListener('click', () => healthAction('heartbeatNow', '正在报平安…（用的是已保存的心跳网址）'));
$('#btnLoginCheckNow').addEventListener('click', () => healthAction('loginCheckNow', '正在检查…会在后台打开三个平台的待发货列表，大约 30 秒。'));

/** 远程指令自动打开的批次页：依次执行排队的指令，做完自动关闭 */
async function runRemoteJobs() {
  document.title = '发货助手 · 正在执行远程指令';
  const banner = $('#remoteBanner');
  banner.hidden = false;
  banner.textContent = '这个页面是远程指令（邮件）自动打开的，正在执行，做完会自动关闭。请不要关它。';
  try {
    for (;;) {
      const job = await takeNextJob();
      if (!job) break;
      await chrome.storage.local.set({ remoteActive: { at: Date.now(), id: job.id } });
      await updateRemoteLog(job.id, { result: '正在执行…', state: 'running' });
      banner.textContent = `正在执行远程指令：${ACTION_NAMES[job.action]}（${job.from}）。做完会自动关闭这个页面，请不要关它。`;
      let out;
      try {
        out = await runRemoteJob(job);
      } catch (e) {
        out = { ok: false, short: `出错：${e.message}`, text: `执行时出错：${e.message}\n\n可以再发一次指令，或者用远程桌面看看这台电脑。` };
      }
      const m = await replyTo(job, out.ok ? '完成 ✅' : '出问题了 ⚠', out.text);
      await updateRemoteLog(job.id, { result: out.short + (m.ok ? '' : `（回信失败：${m.error}）`), state: out.ok ? 'done' : 'failed' });
    }
  } finally {
    await chrome.storage.local.set({ remoteActive: null });
    setBusy(false);
    $('#runBox').hidden = true;
    await render();
    await renderLastRun();
    await renderScanSummary();
    await renderRemoteLog();
    banner.textContent = '远程指令执行完了，这个页面 10 秒后自动关闭。';
    setTimeout(async () => {
      try { const me = await chrome.tabs.getCurrent(); if (me) await chrome.tabs.remove(me.id); } catch { window.close(); }
    }, 10000);
  }
}

async function waitManualRunFinish(maxMs = 20 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const { runStatus } = await chrome.storage.local.get('runStatus');
    if (!(runStatus && runStatus.running && Date.now() - runStatus.at < 10 * 60 * 1000)) return;
    if (Date.now() - t0 > maxMs) return;
    $('#runMsg').textContent = '有人正在这台电脑上手动拉取，等它结束后再执行远程指令…';
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function problemLines(x) {
  return [
    ...(x.loginIssues || []).map((p) => `${PNAME[p] || p} 需要重新登录（用远程桌面在这台电脑的 Chrome 里登录，然后再发一次指令）`),
    ...(x.failures || []).map((f) => String(f).split('\n')[0]),
  ];
}

async function runRemoteJob(job) {
  const s = await getSettings();
  if (job.action === 'resend') return remoteResend(s);

  // ① 拉取
  setBusy(true, true);
  $('#runBox').hidden = false;
  await waitManualRunFinish();
  const onProgress = (msg) => { $('#runMsg').textContent = `［远程指令］${msg}`; };
  let res;
  try {
    res = await runAll(onProgress, {});
  } catch (e) {
    if (e.code !== 'BUSY') throw e;
    res = await runAll(onProgress, { force: true });
  } finally {
    setBusy(false);
    $('#runBox').hidden = true;
  }
  if (res.stopped) return { ok: false, short: '被手动停止', text: '这次运行在电脑上被手动停止了，没有打包。' };
  const { lastScan } = await chrome.storage.local.get('lastScan');
  const x = (lastScan && lastScan.extra) || {};
  const problems = problemLines(x);

  // ② 哪些可以打包：有面单的（同一订单有一行有面单就算有）；
  //    设置「全选」时批次里全部订单都算（包括之前打包过的），否则只算表格里勾选的
  const all = await getOrders();
  const orders = s.remote.includePacked !== false ? all : all.filter((o) => o.include !== false);
  const key = (o) => `${o.platform}|${o.orderId || o.id}`;
  const labeled = new Set(orders.filter((o) => o.hasLabel).map(key));
  const ready = orders.filter((o) => labeled.has(key(o)));
  const missing = [...new Map(orders.filter((o) => !labeled.has(key(o))).map((o) => [key(o), o])).values()];
  const readyPk = new Set(ready.map(key)).size;
  const readyUnits = ready.reduce((n, o) => n + (Number(o.qty) || 1), 0);
  const missingLines = missing.map((o) => `  ${PNAME[o.platform] || o.platform} 订单 ${o.orderId || '—'} · ${String(o.title || '').slice(0, 50)}`);
  const prevPk = [...new Map(ready.filter((o) => o.prevPacked || o.packedAt).map((o) => [key(o), o])).values()];
  const skippedPk = s.remote.includePacked !== false ? 0
    : new Set(all.filter((o) => o.include === false && (o.prevPacked || o.packedAt)).map(key)).size;
  const prevTail = prevPk.length ? ['', `其中之前打包过的（${prevPk.length} 个，请确认没有已经寄出）：`,
    ...prevPk.map((o) => `  ${PNAME[o.platform] || o.platform} 订单 ${o.orderId || '—'} · ${String(o.title || '').slice(0, 50)}`)] : [];
  const tail = [
    ...(skippedPk ? ['', `另有 ${skippedPk} 个之前打包过的订单没算进来（设置里没开「远程打包时全选」）。`] : []),
    ...(missingLines.length ? ['', `缺面单、没有打包的（${missing.length} 个）：`, ...missingLines, '  可以等平台出面单后再发一次「打包」指令。'] : []),
    ...(problems.length ? ['', '需要处理：', ...problems.map((p) => `  ⚠ ${p}`)] : []),
  ];

  if (job.action === 'pull') {
    return {
      ok: !problems.length,
      short: `拉取完成：可打包 ${readyPk} 个包裹，缺面单 ${missing.length} 个${problems.length ? `，${problems.length} 个问题` : ''}`,
      text: [`拉取完成（预览，没有打包、没有发邮件）：现在可以打包 ${readyPk} 个包裹、${readyUnits} 件商品。`,
        ...(ready.length ? ['', '会打包的订单：', ...assignCodes(ready).map((r) => `  ${r.code}  ${PNAME[r.platform] || r.platform}  ${r.sku || '无SKU'} × ${r.qty}  ${String(r.title || '').slice(0, 50)}${r.prevPacked || r.packedAt ? '（之前打包过）' : ''}`)] : []),
        '', '确认没问题，发一封「打包」指令就会打包并发邮件（会重新拉取一次最新状态）。', ...tail].join('\n'),
    };
  }

  // ③ 打包 + 发邮件
  if (!ready.length) {
    return {
      ok: !problems.length,
      short: `没有可打包的订单${problems.length ? `，${problems.length} 个问题` : ''}`,
      text: ['拉取完成：没有可以打包的新订单，没有给员工发邮件。', ...tail].join('\n'),
    };
  }
  const to = s.remote.sendTo === '__all__' ? (s.emailTo || []) : (s.emailTo || []).filter((a) => a === s.remote.sendTo);
  if (!to.length) {
    return { ok: false, short: '没有设置打包后发给谁', text: `可以打包 ${readyPk} 个包裹，但设置里没有选「打包后发给」谁，所以没有打包。请用远程桌面到批次页「设置 → 远程指令」里选好收件人。` };
  }
  const pk = await exportPackage({
    orders: ready, trigger: '远程指令（邮件）',
    startedAt: lastScan ? new Date(lastScan.startedAt) : new Date(), extra: x,
  });
  const now = Date.now();
  for (const id of pk.sentIds) await updateOrder(id, { packedAt: now, include: false, prevPacked: true });
  const mail = buildEmail(pk.rows, pk.zipName, pk.date, { subject: s.emailSubject, body: s.emailBody });
  const bcc = (s.emailBcc || []).filter((b) => !to.some((t) => t.toLowerCase() === b.toLowerCase()));
  const msg = { from: s.emailFrom, to, bcc, subject: mail.subject, body: mail.body, zipName: pk.zipName, zipBytes: pk.zipBytes };
  const m = await sendPackageMail(msg);
  await chrome.storage.local.set({ lastMail: { at: Date.now(), ok: m.ok, error: m.ok ? '' : m.error, to, from: s.emailFrom, zipName: pk.zipName } });
  const head = `${new Set(pk.rows.map((r) => r.code)).size} 个包裹、${pk.rows.reduce((n, r) => n + r.qty, 0)} 件商品`;
  if (!m.ok) {
    await idbPut('remotePendingMail', msg); // 留着，「重发」指令用
    return {
      ok: false,
      short: `已打包 ${head}，但邮件没发出去：${m.error}`,
      text: [`发货已经打好（${head}，电脑上保存在 ${pk.folder}/），但邮件没有发出去：`, `  ${m.error}`,
        '', '网络恢复后，发一封「重发」指令就会把这个发货文件再发一次（不会重新打包）。', ...prevTail, ...tail].join('\n'),
    };
  }
  await idbDel('remotePendingMail');
  return {
    ok: !problems.length && !missing.length,
    short: `已打包 ${head}，已发给 ${to.join('、')}`,
    text: [`完成：${head}，已发给 ${to.join('、')}。`,
      `附件：${pk.zipName}（电脑上也存了一份：${pk.folder}/）`, ...prevTail, ...tail].join('\n'),
  };
}

async function remoteResend() {
  const msg = await idbGet('remotePendingMail');
  if (!msg) return { ok: true, short: '没有需要重发的', text: '没有发送失败、需要重发的发货文件。' };
  const m = await sendPackageMail(msg);
  if (!m.ok) return { ok: false, short: `重发失败：${m.error}`, text: `重发还是失败了：\n  ${m.error}\n\n可以稍后再发一次「重发」指令。` };
  await idbDel('remotePendingMail');
  await chrome.storage.local.set({ lastMail: { at: Date.now(), ok: true, to: msg.to, from: msg.from, zipName: msg.zipName } });
  return { ok: true, short: `已重发给 ${msg.to.join('、')}`, text: `已把 ${msg.zipName} 重新发给 ${msg.to.join('、')}。` };
}

// ===================== 手动添加订单 =====================
async function renderManualPkgs() {
  const orders = await getOrders();
  const keep = $('#mPkg').value;
  const inc = orders.filter((o) => o.include !== false);
  const coded = new Map(assignCodes(inc).map((r) => [groupKey(r), r.code]));
  const groups = new Map();
  for (const o of orders) if (!groups.has(groupKey(o))) groups.set(groupKey(o), o);
  const opts = [...groups.entries()].map(([k, o]) => {
    const code = coded.get(k) || '（未勾选）';
    const name = (PLATFORM_META[o.platform] || PLATFORM_META.other).name;
    return { k, label: `${code} · ${name}${o.orderId && !/^手动-/.test(o.orderId) ? ` · 订单 ${o.orderId}` : ''} · ${String(o.title || o.sku || '').slice(0, 24)}`, code };
  }).sort((a, b) => a.code.localeCompare(b.code));
  $('#mPkg').innerHTML = '<option value="">新包裹（打包时自动编号）</option>'
    + opts.map((x) => `<option value="${esc(x.k)}">加进 ${esc(x.label)}</option>`).join('');
  if ([...$('#mPkg').options].some((o) => o.value === keep)) $('#mPkg').value = keep;
  syncManualPkg(orders);
}
async function syncManualPkg(orders) {
  const k = $('#mPkg').value;
  const joining = !!k;
  $('#mPlatform').disabled = joining;
  $('#mOrderId').disabled = joining;
  $('#mLabelHint').textContent = '';
  if (joining) {
    const same = (orders || await getOrders()).filter((o) => groupKey(o) === k);
    if (same[0]) {
      $('#mPlatform').value = PLATFORM_META[same[0].platform] && same[0].platform !== 'ebay' ? same[0].platform : 'other';
      $('#mOrderId').value = /^手动-/.test(same[0].orderId || '') ? '' : (same[0].orderId || '');
      if (same.some((o) => o.hasLabel)) $('#mLabelHint').textContent = '这个包裹已经有面单，可以不传';
    }
  }
}
$('#mPkg').addEventListener('change', () => syncManualPkg());
$('#mImage').addEventListener('change', () => {
  const f = $('#mImage').files[0];
  const img = $('#mImagePreview');
  if (f) { img.src = URL.createObjectURL(f); img.hidden = false; } else img.hidden = true;
});
function resetManual() {
  for (const id of ['#mOrderId', '#mTitle', '#mSku', '#mImage', '#mLabel']) $(id).value = '';
  $('#mQty').value = '1';
  $('#mImagePreview').hidden = true;
}
$('#btnManualReset').addEventListener('click', resetManual);
$('#btnManualAdd').addEventListener('click', async () => {
  const title = $('#mTitle').value.trim();
  const sku = $('#mSku').value.trim();
  if (!title && !sku) { alert('商品名和 SKU 至少填一个。'); $('#mTitle').focus(); return; }
  const qty = parseInt($('#mQty').value, 10);
  if (!(qty >= 1)) { alert('数量至少是 1。'); $('#mQty').focus(); return; }
  const labelFile = $('#mLabel').files[0] || null;
  let labelBlob = null;
  if (labelFile) {
    const bytes = new Uint8Array(await labelFile.arrayBuffer());
    const type = (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ? 'application/pdf'
      : (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'image/png' : (bytes[0] === 0xff && bytes[1] === 0xd8) ? 'image/jpeg' : '';
    if (!type) { alert('面单只能是 PDF、PNG 或 JPG。'); return; }
    labelBlob = new Blob([bytes], { type });
  }
  const imgFile = $('#mImage').files[0] || null;
  try {
    await addManualOrder({
      joinGroup: $('#mPkg').value, platform: $('#mPlatform').value, orderId: $('#mOrderId').value,
      title, sku, qty, imageBlob: imgFile, labelBlob,
    });
  } catch (e) { alert(e.message); return; }
  resetManual();
  await render();
  await renderManualPkgs();
  showNote(`已添加「${title || sku}」${$('#mPkg').value ? '到所选包裹' : '（新包裹）'}${labelBlob ? '，面单已对应' : '，还没有面单（可以之后在表格里拖进去）'}。`);
});

function showScan(s) {
  if (!s) return;
  const el = $('#scan');
  el.hidden = false;
  el.textContent = s.running
    ? `正在扫描：${s.done}/${s.total}…`
    : `扫描完成：新增 ${s.added} 条，失败 ${s.errors.length} 条。${s.errors.length ? '\n' + s.errors.join('\n') : ''}请逐行核对商品名、SKU 和数量。`;
  el.style.whiteSpace = 'pre-wrap';
}

// 中文 / English 切换（选择记在这台电脑的浏览器里）
initI18n();
$('#btnLang').addEventListener('click', () => { setLang(getLang() === 'en' ? 'zh' : 'en'); renderRemoteHelp(); });

(async () => {
  await render();
  await renderSettings();
  await renderLastRun();
  await renderScanSummary();
  await renderEmails();
  $('#ver').textContent = `V${chrome.runtime.getManifest().version}`;
  // 带 #run（所有平台）或 #run=depop（只拉一个平台）打开时直接开始拉取
  await renderRemote();
  await renderHealth();
  await renderManualPkgs();
  if (location.hash === '#remote') {
    history.replaceState(null, '', location.pathname);
    runRemoteJobs();
    return;
  }
  const m = location.hash.match(/^#run(?:=(\w+))?$/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    startRun(m[1] || 'all');
  }
  const { scanStatus } = await chrome.storage.local.get('scanStatus');
  if (scanStatus && scanStatus.running) showScan(scanStatus);
})();
