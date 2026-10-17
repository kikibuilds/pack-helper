// 诊断信息：把各处已经记下的运行情况（上次拉取、面单失败、登录状态、远程指令、发邮件、心跳）整理成一份。
// 纯函数，不读写存储，方便测试。导出时把邮箱、心跳网址里的密钥打码，暗号永远不出现。

const PNAME = { poshmark: 'Poshmark', mercari: 'Mercari', depop: 'Depop', ebay: 'eBay' };
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');

/** a.b@gmail.com → a***@gmail.com */
export function maskEmail(s) {
  return String(s || '').replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
}
/** https://hc-ping.com/1234-abcd-… → https://hc-ping.com/1234… （只留路径开头 4 个字符） */
export function maskUrl(u) {
  try { const x = new URL(u); const p = x.pathname.replace(/^\//, ''); return `${x.origin}/${p.slice(0, 4)}${p.length > 4 ? '…' : ''}`; } catch { return u ? '（格式不对）' : ''; }
}
const clean = (s) => maskEmail(String(s == null ? '' : s));

/**
 * @param {object} d  { version, settings, lastScan, lastRun, lastMail, remoteLastPoll, remoteLog, heartbeatLast,
 *                      loginCheckLast, loginCheckLog, orders, mailer }
 * @returns {{ status: Array<{name, level:'ok'|'warn'|'bad'|'off', text}>, sections: Array<{title, lines:string[]}> }}
 */
export function buildDiagnostics(d) {
  const s = d.settings || {};
  const h = s.health || {};
  const r = s.remote || {};
  const scan = d.lastScan || null;
  const status = [];
  const add = (name, level, text) => status.push({ name, level, text });

  add('插件版本', 'ok', `V${d.version || '?'}`);
  if (d.mailer) add('邮件程序', d.mailer.ok ? 'ok' : 'bad', d.mailer.ok ? `已连接（版本 ${d.mailer.version}）` : clean(d.mailer.error));
  else add('邮件程序', 'off', '还没检查（点「检查邮件程序」）');

  // 平台登录：每日检查和上次拉取，哪个新用哪个
  const lc = d.loginCheckLast;
  const scanLogin = scan && scan.byPlatform ? scan.byPlatform : {};
  for (const p of ['poshmark', 'mercari', 'depop']) {
    const fromCheck = lc && (lc.results || []).find((x) => x.platform === p);
    const fromScan = scanLogin[p];
    const checkAt = fromCheck ? lc.at : 0;
    const scanAt = fromScan ? fromScan.at : 0;
    if (!checkAt && !scanAt) { add(`${PNAME[p]} 登录`, 'off', '还没检查过'); continue; }
    if (checkAt >= scanAt) {
      if (!fromCheck.ok) add(`${PNAME[p]} 登录`, 'warn', `没能检查（${clean(fromCheck.why)}），${fmt(checkAt)} 每日检查`);
      else add(`${PNAME[p]} 登录`, fromCheck.loggedIn ? 'ok' : 'bad', `${fromCheck.loggedIn ? '已登录' : '需要重新登录'}（${fmt(checkAt)} 每日检查）`);
    } else {
      add(`${PNAME[p]} 登录`, fromScan.loginIssue ? 'bad' : 'ok', `${fromScan.loginIssue ? '需要重新登录' : '已登录'}（${fmt(scanAt)} 拉取时）`);
    }
  }

  const hb = d.heartbeatLast;
  if (!h.heartbeatEnabled) add('掉线报警（心跳）', 'off', '没有开启');
  else if (!hb) add('掉线报警（心跳）', 'warn', '已开启，还没报过平安');
  else add('掉线报警（心跳）', hb.ok ? 'ok' : 'bad', `${hb.ok ? '正常' : clean(hb.error)}（上次 ${fmt(hb.at)}，每 ${h.heartbeatMin} 分钟）`);

  if (!h.loginCheckEnabled) add('每日登录检查', 'off', '没有开启');
  else add('每日登录检查', lc ? 'ok' : 'warn', `每天 ${h.loginCheckTime}${lc ? `，上次 ${fmt(lc.at)}` : '，还没运行过'}${h.loginCheckNotify ? '' : '（没填提醒邮箱，只记录不发邮件）'}`);

  const rp = d.remoteLastPoll;
  if (!r.enabled) add('远程指令', 'off', '没有开启');
  else if (!rp) add('远程指令', 'warn', `已开启（每 ${r.intervalMin} 分钟），还没查过收件箱`);
  else add('远程指令', rp.ok ? 'ok' : 'bad', `${rp.ok ? '收件箱检查正常' : `检查失败：${clean(rp.error)}`}（${fmt(rp.at)}）`);

  const lm = d.lastMail;
  if (lm) add('上次发邮件', lm.ok ? 'ok' : 'bad', `${fmt(lm.at)}，${lm.ok ? '成功' : `失败：${clean(lm.error)}`}`);

  // —— 详细问题 ——
  const sections = [];
  if (scan) {
    const lines = [`拉取时间：${fmt(scan.at)}`];
    for (const [p, b] of Object.entries(scan.byPlatform || {})) {
      const st = b.stat || {};
      lines.push(`【${PNAME[p] || p}】${fmt(b.at)}：列表中 ${st.found || 0} 单，新加入 ${st.added || 0}，已寄出跳过 ${st.shipped || 0}，之前打包过 ${st.skipped || 0}，失败 ${st.failed || 0}${b.loginIssue ? '，⚠ 需要重新登录' : ''}`);
      for (const f of b.failures || []) lines.push(`  ✗ ${clean(f)}`);
      for (const f of b.labelFailures || []) lines.push(`  ✗ 面单：${clean(f)}`);
      for (const w of b.warnings || []) lines.push(`  ! ${clean(w)}`);
    }
    sections.push({ title: '上次拉取', lines });
  } else sections.push({ title: '上次拉取', lines: ['还没有拉取过'] });

  const missing = (d.orders || []).filter((o) => o.include !== false && !o.hasLabel);
  sections.push({
    title: '批次里还缺面单的订单',
    lines: missing.length
      ? missing.map((o) => `${PNAME[o.platform] || o.platform} ${o.orderId || '（无订单号）'} · ${clean(o.title).slice(0, 50)}：${clean(o.labelError || '还没抓到面单')}`)
      : ['没有'],
  });

  sections.push({
    title: '每日登录检查记录',
    lines: (d.loginCheckLog || []).length
      ? d.loginCheckLog.slice(0, 10).map((e) => `${fmt(e.at)}${e.trigger === 'manual' ? '（手动）' : ''}：${(e.results || []).map((x) => `${PNAME[x.platform] || x.platform} ${x.ok ? (x.loggedIn ? '已登录' : '需要重新登录') : `没能检查（${clean(x.why)}）`}`).join('；')}${e.mail ? `；提醒邮件${e.mail.ok ? '已发送' : `发送失败：${clean(e.mail.error)}`}` : ((e.results || []).some((x) => x.loggedIn === false) ? '；没填提醒邮箱，没发邮件' : '')}`)
      : ['还没有记录'],
  });

  sections.push({
    title: '远程指令记录（最近 10 条）',
    lines: (d.remoteLog || []).length
      ? d.remoteLog.slice(0, 10).map((e) => `${fmt(e.at)} · ${clean(e.from)} · ${e.action} · ${clean(e.result)}`)
      : ['还没有收到过远程指令'],
  });

  if (d.lastRun) sections.push({ title: '上次打包', lines: [`${fmt(d.lastRun.at)}：${clean(d.lastRun.summary)}`] });

  sections.push({
    title: '设置摘要',
    lines: [
      `发件邮箱：${clean(s.emailFrom) || '（没填）'}；收件人 ${(s.emailTo || []).length} 个`,
      `远程指令：${r.enabled ? `开启，每 ${r.intervalMin} 分钟` : '关闭'}；允许的邮箱 ${(r.allow || []).length} 个`,
      `心跳：${h.heartbeatEnabled ? `开启，每 ${h.heartbeatMin} 分钟 → ${maskUrl(h.heartbeatUrl)}` : '关闭'}`,
      `每日登录检查：${h.loginCheckEnabled ? `开启，每天 ${h.loginCheckTime}，提醒发给 ${clean(h.loginCheckNotify) || '（没填）'}` : '关闭'}`,
      ...Object.entries(s.listUrls || {}).map(([p, u]) => `${PNAME[p] || p} 待发货列表：${u}`),
    ],
  });
  return { status, sections };
}

/** 导出成纯文本（给开发者看的诊断文件） */
export function diagnosticsText(diag, at = Date.now()) {
  const mark = { ok: '✓', warn: '!', bad: '✗', off: '·' };
  return [
    `发货助手 · 诊断信息（${fmt(at)}，电脑时间）`,
    '邮箱已打码，暗号和心跳网址的密钥不包含在内；不含买家姓名和地址。',
    '',
    '== 状态 ==',
    ...diag.status.map((x) => `${mark[x.level] || ''} ${x.name}：${x.text}`),
    ...diag.sections.flatMap((sec) => ['', `== ${sec.title} ==`, ...sec.lines]),
    '',
  ].join('\n');
}
