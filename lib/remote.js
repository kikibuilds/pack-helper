// 远程指令（邮件触发）：后台定时让 Mac 上的邮件程序查一下 Gmail 收件箱，
// 白名单邮箱发来、标题带暗号的邮件 → 拉取 / 打包并发邮件 / 回复状态。
// 后台（background.js）和批次页都会用到这个文件，所以这里不引入打包相关的代码。
import { callMailer, sendPackageMail } from './mail.js';
import { getSettings, getOrders, moduleOn } from './store.js';

export const ACTION_NAMES = { pack: '拉取 + 打包 + 发邮件', pull: '拉取预览（不打包、不发邮件）', status: '查看状态', resend: '重发上次没发出去的发货文件' };
const LOG_MAX = 40;
const ACTIVE_STALE_MS = 45 * 60 * 1000; // 超过 45 分钟还没结束，认为上次的执行页被关掉了

const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });

export async function addRemoteLog(entry) {
  const { remoteLog = [] } = await chrome.storage.local.get('remoteLog');
  remoteLog.unshift({ at: Date.now(), ...entry });
  await chrome.storage.local.set({ remoteLog: remoteLog.slice(0, LOG_MAX) });
}

export async function updateRemoteLog(id, patch) {
  const { remoteLog = [] } = await chrome.storage.local.get('remoteLog');
  const e = remoteLog.find((x) => x.id === id);
  if (e) Object.assign(e, patch, { updatedAt: Date.now() });
  await chrome.storage.local.set({ remoteLog });
}

/** 回复指令邮件（接在同一个对话里） */
export async function replyTo(cmd, title, body) {
  const s = await getSettings();
  // 回信标题里去掉暗号：顺手回复这封信时不会被当成新指令，暗号也不会出现在转发里
  const secret = (s.remote.secret || '').trim();
  let base = secret ? cmd.subject.split(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' ') : cmd.subject;
  base = base.replace(/^\s*((re|fwd?|回复|转发)\s*[:：]\s*)+/i, '').replace(/\s+/g, ' ').trim();
  const subj = `Re: [发货助手] ${base || '指令'}`;
  return sendPackageMail({
    from: s.emailFrom,
    to: [cmd.from],
    subject: title && !subj.includes(title) ? `${subj} · ${title}` : subj,
    body,
    inReplyTo: cmd.messageId,
  });
}

/** 状态报告（「暗号 状态」指令的回复） */
export async function buildStatusText() {
  const s = await getSettings();
  const { lastScan, lastRun, lastMail, runStatus, remoteQueue = [], heartbeatLast, loginCheckLast } =
    await chrome.storage.local.get(['lastScan', 'lastRun', 'lastMail', 'runStatus', 'remoteQueue', 'heartbeatLast', 'loginCheckLast']);
  const ping = await callMailer({ action: 'ping' }, 20000);
  const orders = await getOrders();
  const inc = orders.filter((o) => o.include !== false);
  const key = (o) => `${o.platform}|${o.orderId || o.id}`;
  const pk = new Set(inc.map(key));
  const withLabel = new Set(inc.filter((o) => o.hasLabel).map(key));
  const name = { poshmark: 'Poshmark', mercari: 'Mercari', depop: 'Depop', whatnot: 'Whatnot' };
  const lines = [
    `发货助手状态（${fmt(Date.now())}，电脑时间）`,
    '',
    '· 电脑和 Chrome：在线（能收到这封回信就说明在线）',
    `· 插件版本：V${(chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version)}；邮件程序版本：${ping.ok ? ping.version : '读取失败'}`,
    `· 远程指令：每 ${s.remote.intervalMin} 分钟查一次收件箱；排队中的指令 ${remoteQueue.length} 个`,
    `· 现在${runStatus && runStatus.running && Date.now() - runStatus.at < 10 * 60 * 1000 ? `正在运行：${runStatus.msg || ''}` : '没有在运行'}`,
    `· 批次里勾选待打包：${pk.size} 个包裹${pk.size - withLabel.size ? `（其中 ${pk.size - withLabel.size} 个缺面单）` : ''}`,
  ];
  if (lastScan) {
    const x = lastScan.extra || {};
    lines.push(`· 上次拉取：${fmt(lastScan.at)}`);
    for (const p of x.loginIssues || []) lines.push(`    ⚠ ${name[p] || p} 需要重新登录（用远程桌面在这台电脑的 Chrome 里登录）`);
    for (const f of (x.failures || []).slice(0, 5)) lines.push(`    ⚠ ${String(f).split('\n')[0]}`);
  } else lines.push('· 上次拉取：还没有');
  lines.push(lastRun ? `· 上次打包：${fmt(lastRun.at)}，${lastRun.summary}` : '· 上次打包：还没有');
  if (lastMail) lines.push(`· 上次发邮件：${fmt(lastMail.at)}，${lastMail.ok ? '成功' : `失败（${lastMail.error}）`}`);
  if (s.health.heartbeatEnabled) lines.push(heartbeatLast ? `· 心跳：上次 ${fmt(heartbeatLast.at)}，${heartbeatLast.ok ? '正常' : `失败（${heartbeatLast.error}）`}` : '· 心跳：已开启，还没报过');
  if (loginCheckLast) {
    const out = (loginCheckLast.results || []).filter((r) => r.loggedIn === false).map((r) => name[r.platform] || r.platform);
    lines.push(`· 上次登录检查：${fmt(loginCheckLast.at)}，${out.length ? `${out.join('、')} 需要重新登录` : '各平台都已登录'}`);
  }
  return lines.join('\n');
}

/** 排队等批次页执行的指令 */
async function enqueue(cmd) {
  const { remoteQueue = [] } = await chrome.storage.local.get('remoteQueue');
  remoteQueue.push(cmd);
  await chrome.storage.local.set({ remoteQueue });
  return remoteQueue.length;
}

export async function takeNextJob() {
  const { remoteQueue = [] } = await chrome.storage.local.get('remoteQueue');
  const job = remoteQueue.shift();
  await chrome.storage.local.set({ remoteQueue });
  return job;
}

async function runnerActive() {
  const { remoteActive } = await chrome.storage.local.get('remoteActive');
  return !!(remoteActive && Date.now() - remoteActive.at < ACTIVE_STALE_MS);
}

/** 打开一个批次页来执行排队的指令（批次页才能做打包：要用到 PDF、下载等） */
async function openRunner() {
  const url = chrome.runtime.getURL('batch.html#remote');
  await chrome.storage.local.set({ remoteActive: { at: Date.now() } });
  try {
    await chrome.tabs.create({ url, active: false });
  } catch {
    // Chrome 开着但没有窗口时
    await chrome.windows.create({ url, focused: false });
  }
}

/**
 * 查一次收件箱，处理新指令。
 * @param {'alarm'|'manual'} trigger
 * @returns {{ok:boolean, error?:string, commands?:number, rejected?:number, skipped?:string}}
 */
export async function pollOnce(trigger = 'alarm') {
  const s = await getSettings();
  const r = s.remote;
  if (trigger === 'alarm' && !r.enabled) return { ok: true, skipped: '远程指令没有开启' };
  if (!r.allow.length) return { ok: false, error: '还没有填「允许发指令的邮箱」。' };
  if ((r.secret || '').trim().length < 4) return { ok: false, error: '暗号至少 4 个字。' };
  // 同一时间只查一次
  const { remotePollLock } = await chrome.storage.local.get('remotePollLock');
  if (remotePollLock && Date.now() - remotePollLock < 90 * 1000) return { ok: true, skipped: '上一次检查还没结束' };
  await chrome.storage.local.set({ remotePollLock: Date.now() });
  let res;
  try {
    res = await callMailer({ action: 'poll', from: s.emailFrom, allow: r.allow, secret: r.secret.trim(), maxAgeMinutes: 180 }, 90000);
  } finally {
    await chrome.storage.local.set({ remotePollLock: 0 });
  }
  if (!res.ok && /未知操作/.test(res.error || '')) {
    res = { ok: false, error: 'Mac 上的邮件程序是旧版，还不会检查收件箱。请在「终端」运行 bash ~/pack-helper/mailer/install.sh（用 pack-helper 固定文件夹里的那个），装完再点「立即检查一次收件箱」。' };
  }
  await chrome.storage.local.set({ remoteLastPoll: { at: Date.now(), ok: res.ok, error: res.ok ? '' : res.error, trigger } });
  if (!res.ok) return res;

  for (const x of res.rejected || []) {
    await addRemoteLog({ id: `rej-${Date.now()}-${Math.random()}`, from: x.from, subject: x.subject, action: '-', result: `已忽略：${x.reason}`, state: 'rejected' });
  }
  for (const cmd of res.commands || []) {
    const entry = { id: cmd.id, from: cmd.from, subject: cmd.subject, action: cmd.action };
    if (cmd.expired) {
      await addRemoteLog({ ...entry, result: cmd.reason, state: 'rejected' });
      await replyTo(cmd, '没有执行', `${cmd.reason}。\n如果还需要，请重新发一封指令邮件。`);
      continue;
    }
    if (cmd.action === 'status') {
      const text = await buildStatusText();
      const m = await replyTo(cmd, '状态', text);
      await addRemoteLog({ ...entry, result: m.ok ? '已回复状态' : `回复失败：${m.error}`, state: m.ok ? 'done' : 'failed' });
      continue;
    }
    const busy = await runnerActive();
    const n = await enqueue({ ...cmd, receivedAt: Date.now() });
    await addRemoteLog({ ...entry, result: busy ? `排队中（前面还有 ${n - 1} 个）` : '开始执行…', state: 'running' });
    const what = ACTION_NAMES[cmd.action];
    await replyTo(cmd, '收到', busy
      ? `收到指令：${what}。\n上一个指令还在执行，这个已排队（前面还有 ${n - 1} 个），完成后会再回信。`
      : `收到指令：${what}。\n现在开始，一般 3～10 分钟完成，完成后会再回信告诉你结果。`);
    if (!busy) await openRunner();
  }
  return { ok: true, commands: (res.commands || []).length, rejected: (res.rejected || []).length };
}

export async function scheduleRemotePolling() {
  const s = await getSettings();
  await chrome.alarms.clear('remotePoll');
  if (s.remote.enabled && moduleOn(s, 'remote')) {
    const period = Math.max(1, Number(s.remote.intervalMin) || 2);
    await chrome.alarms.create('remotePoll', { delayInMinutes: 0.1, periodInMinutes: period });
  }
}
