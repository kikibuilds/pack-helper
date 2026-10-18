// 运行监控：掉线报警（心跳）、每日登录检查、远程指令记录、诊断。
// 界面在 batch.html 的 <section data-view="monitor">，逻辑在 batch.js + lib/health.js + lib/diag.js。
export default {
  id: 'monitor',
  name: '运行监控',
  icon: '🩺',
  desc: '掉线报警、每日登录检查、远程指令记录、诊断信息导出',
  order: 30,
  view: 'monitor',
  status({ diag }) {
    const logins = diag.filter((x) => / 登录$/.test(x.name));
    const bad = logins.filter((x) => x.level === 'bad').length;
    if (bad) return { level: 'warn', text: `${bad} 个平台需要重新登录` };
    const hb = diag.find((x) => x.name === '掉线报警（心跳）');
    if (hb && hb.level === 'bad') return { level: 'bad', text: '心跳失败' };
    const on = diag.filter((x) => (x.name === '掉线报警（心跳）' || x.name === '每日登录检查') && x.level !== 'off').length;
    return { level: on ? 'ok' : 'off', text: on ? '正常' : '掉线报警和登录检查都没开' };
  },
  todos({ diag }) {
    const out = [];
    for (const s of diag) {
      if (/ 登录$/.test(s.name) && s.level === 'bad') out.push({ level: 'bad', title: `${s.name.replace(/ 登录$/, '')} 需要重新登录`, detail: s.text, route: '#/monitor/diag' });
      if ((s.name === '掉线报警（心跳）' || s.name === '每日登录检查') && (s.level === 'bad' || s.level === 'warn')) {
        out.push({ level: s.level, title: s.name, detail: s.text, route: '#/monitor/alarm' });
      }
    }
    return out;
  },
};
