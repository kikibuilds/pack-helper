// 首页卡片和功能管理用的线条图标（不用 emoji）；没有线条图标的模块（自己加的）用它自己的 emoji。
// 卡片右上角的小标签
export const BADGES = { remote: '自动' };

const svg = (paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  shipping: svg('<path d="M2 6h12v10H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  remote: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  monitor: svg('<path d="M3 12h4l3 7 4-14 3 7h4"/>'),
  modules: svg('<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><circle cx="18" cy="18" r="2"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  box: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
};
/** 模块的图标：有线条图标用线条图标，没有（别人加的模块）就用它自己的 emoji */
export const iconOf = (m) => ICONS[m.id] || `<span class="emoji">${String(m.icon || '•').replace(/[<>&"]/g, '')}</span>`;
