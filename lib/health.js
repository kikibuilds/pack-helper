// 运行状况：① 心跳（给外部监控服务报平安，电脑睡眠 / 断电 / 断网时由对方发提醒）
//          ② 每日登录检查（每天定时打开一次各平台待发货列表，跳到登录页就发邮件提醒）
// 在后台（service worker）里运行。只读：不点任何按钮、不改批次、不抓面单。
import { getSettings, AUTO_PLATFORMS, moduleOn } from './store.js';
import { sendPackageMail } from './mail.js';

const PNAME = { poshmark: 'Poshmark', mercari: 'Mercari', depop: 'Depop', whatnot: 'Whatnot' };
const LOG_MAX = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
export const isLoginUrl = (url) => { try { const u = new URL(url); return /log-?in|sign-?in|signin|auth/i.test(u.hostname + u.pathname); } catch { return false; } };

// ===================== ① 心跳 =====================

/** 心跳网址只允许 https；healthchecks.io、Better Stack、Cronitor 等都给这种「访问一下就算报平安」的网址 */
export const validHeartbeatUrl = (u) => /^https:\/\/[^\s/]+\.[^\s/]+\/\S+$/.test(String(u || '').trim());

/** 报一次平安。返回 {ok, status?, error?} */
export async function beatOnce(trigger = 'alarm') {
  const { health } = await getSettings();
  const url = (health.heartbeatUrl || '').trim();
  if (!url) return { ok: false, error: '还没有填心跳网址' };
  if (!validHeartbeatUrl(url)) return { ok: false, error: '心跳网址要以 https:// 开头' };
  let res;
  try {
    const r = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    res = r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `监控服务返回 HTTP ${r.status}` };
  } catch (e) {
    res = { ok: false, error: `连不上监控服务（${e.message}），可能是这台电脑断网了` };
  }
  await chrome.storage.local.set({ heartbeatLast: { at: Date.now(), trigger, ...res } });
  return res;
}

export async function scheduleHeartbeat() {
  const s = await getSettings();
  const { health } = s;
  await chrome.alarms.clear('heartbeat');
  if (health.heartbeatEnabled && validHeartbeatUrl(health.heartbeatUrl) && moduleOn(s, 'monitor')) {
    const period = Math.max(1, Number(health.heartbeatMin) || 5);
    await chrome.alarms.create('heartbeat', { delayInMinutes: 0.1, periodInMinutes: period });
  }
}

// ===================== ② 每日登录检查 =====================

function waitComplete(tabId, ms = 30000) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function l(id, info) { if (id === tabId && info.status === 'complete') done(); }
    function done() { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(); }
    chrome.tabs.onUpdated.addListener(l);
  });
}
async function openTab(url) {
  try { return await chrome.tabs.create({ url, active: false }); } catch {
    const w = await chrome.windows.create({ url, focused: false, state: 'minimized' }); // Chrome 开着但没有窗口
    return w.tabs[0];
  }
}

/** 打开一个平台的待发货列表，看会不会跳到登录页。返回 {ok, loggedIn, why?} */
async function checkPlatform(url) {
  let tab;
  try {
    tab = await openTab(url);
    await waitComplete(tab.id);
    await sleep(3500); // 有些平台加载完才跳转登录页
    const cur = await chrome.tabs.get(tab.id);
    return { ok: true, loggedIn: !isLoginUrl(cur.url || '') };
  } catch (e) {
    return { ok: false, loggedIn: null, why: e.message };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** 下一次「每天 HH:MM」的时间戳 */
export function nextDailyAt(hhmm, now = Date.now()) {
  const [h, m] = String(hhmm || '08:00').split(':').map((x) => parseInt(x, 10) || 0);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now + 30000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export async function scheduleLoginCheck() {
  const s = await getSettings();
  const { health } = s;
  await chrome.alarms.clear('loginCheck');
  if (health.loginCheckEnabled && moduleOn(s, 'monitor')) {
    await chrome.alarms.create('loginCheck', { when: nextDailyAt(health.loginCheckTime), periodInMinutes: 24 * 60 });
  }
}

/** 登录检查的提醒邮件内容（纯函数，方便测试） */
export function loginAlertMail(results, at = Date.now()) {
  const out = results.filter((r) => r.loggedIn === false).map((r) => PNAME[r.platform] || r.platform);
  const failed = results.filter((r) => !r.ok).map((r) => `${PNAME[r.platform] || r.platform}（${r.why}）`);
  if (!out.length) return null;
  return {
    subject: `[发货助手] ${out.join('、')} 需要重新登录`,
    body: [
      `每日登录检查（${fmt(at)}，电脑时间）发现：`,
      '',
      ...out.map((p) => `· ${p}：打开待发货列表时跳到了登录页，需要重新登录`),
      ...(failed.length ? ['', `另外这些平台没能检查：${failed.join('、')}`] : []),
      '',
      '处理方法：在这台电脑的 Chrome 里打开对应平台重新登录（人不在电脑旁时用远程桌面）。',
      '登录后可以发一封「暗号 状态」的远程指令确认，或者等明天的检查。',
    ].join('\n'),
  };
}

async function addLoginLog(entry) {
  const { loginCheckLog = [] } = await chrome.storage.local.get('loginCheckLog');
  loginCheckLog.unshift(entry);
  await chrome.storage.local.set({ loginCheckLog: loginCheckLog.slice(0, LOG_MAX), loginCheckLast: entry });
}

/**
 * 检查一次所有平台的登录状态。
 * @param {'alarm'|'manual'} trigger  manual = 设置页「立即检查一次」，结果照样发邮件
 */
export async function loginCheckOnce(trigger = 'alarm') {
  const s = await getSettings();
  const h = s.health;
  if (trigger === 'alarm' && !h.loginCheckEnabled) return { ok: true, skipped: '每日登录检查没有开启' };
  // 一键拉取 / 远程指令正在运行：15 分钟后再试一次（只补一次）
  const { runStatus, remoteActive, loginCheckLock } = await chrome.storage.local.get(['runStatus', 'remoteActive', 'loginCheckLock']);
  const busy = (runStatus && runStatus.running && Date.now() - runStatus.at < 10 * 60 * 1000)
    || (remoteActive && Date.now() - remoteActive.at < 45 * 60 * 1000);
  if (busy) {
    if (trigger === 'alarm') await chrome.alarms.create('loginCheckRetry', { delayInMinutes: 15 });
    return { ok: true, skipped: '一键拉取或远程指令正在运行，15 分钟后再检查' };
  }
  if (loginCheckLock && Date.now() - loginCheckLock < 5 * 60 * 1000) return { ok: true, skipped: '上一次检查还没结束' };
  await chrome.storage.local.set({ loginCheckLock: Date.now() });
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  try {
    const results = [];
    for (const p of AUTO_PLATFORMS) {
      const url = s.listUrls[p];
      if (!url) continue;
      results.push({ platform: p, ...(await checkPlatform(url)) });
    }
    const mail = loginAlertMail(results);
    let mailResult = null;
    const to = (h.loginCheckNotify || '').trim();
    if (mail && to) {
      const m = await sendPackageMail({ from: s.emailFrom, to: [to], subject: mail.subject, body: mail.body });
      mailResult = m.ok ? { ok: true, to } : { ok: false, to, error: m.error };
    }
    const entry = { at: Date.now(), trigger, results, mail: mailResult };
    await addLoginLog(entry);
    return { ok: true, ...entry };
  } finally {
    clearInterval(keepAlive);
    await chrome.storage.local.set({ loginCheckLock: 0 });
  }
}

export const describeLoginResult = (r) => (r.ok
  ? `${PNAME[r.platform] || r.platform}：${r.loggedIn ? '已登录' : '需要重新登录'}`
  : `${PNAME[r.platform] || r.platform}：没能检查（${r.why}）`);
