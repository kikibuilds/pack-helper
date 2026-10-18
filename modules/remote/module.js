// 远程指令：人不在电脑旁时，发一封邮件让这台电脑自动拉取、打包、发邮件。
// 界面在 batch.html 的 <section data-view="remote">，逻辑在 batch.js + lib/remote.js。
const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default {
  id: 'remote',
  name: '远程指令',
  icon: '📨',
  desc: '人不在电脑旁时，发一封邮件让这台电脑自动拉取、打包、发邮件，再回信告诉你结果',
  order: 20,
  view: 'remote',
  status({ settings, local }) {
    const r = settings.remote;
    if (!r.enabled) return { level: 'off', text: '未开启' };
    const p = local.remoteLastPoll;
    if (p && !p.ok) return { level: 'bad', text: `检查收件箱失败（${fmt(p.at)}）` };
    return { level: 'ok', text: `已开启 · 每 ${r.intervalMin} 分钟${p ? ` · 上次 ${fmt(p.at)}` : ''}` };
  },
  todos({ diag }) {
    const s = diag.find((x) => x.name === '远程指令');
    return s && (s.level === 'bad' || s.level === 'warn') ? [{ level: s.level, title: '远程指令', detail: s.text, route: '#/remote' }] : [];
  },
};
