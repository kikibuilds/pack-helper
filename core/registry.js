// 功能模块注册表。
//
// 发货助手的首页、导航、「功能管理」都从这里读：每个功能（发货、远程指令、运行监控……）
// 是一个模块，用 registerModule() 登记一份说明。加一个功能 = 多登记一个模块，外壳不用改。
//
// 模块说明（descriptor）的字段，详见 docs/MODULES.md：
//   id        唯一英文名，也是路由名：#/<id>、#/<id>/<子页面>
//   name      显示名称          icon  首页卡片图标（emoji）
//   desc      首页卡片上的一句话简介
//   order     排序（小的在前）
//   core      true = 必备模块，不能在「功能管理」里关掉
//   view      页面里已有的 <section data-view="..."> 的名字（内置模块用）
//   mount(el) 没有现成页面的模块（比如私有模块）自己往 el 里画界面
//   status(ctx)  → { level: 'ok'|'warn'|'bad'|'off', text }  首页卡片底部的状态
//   todos(ctx)   → [{ level, title, detail, route }]          首页「需要处理」
//   panes        往别的模块页面里加子页面：[{ view: 'monitor', id, title, mount(el) }]
//
// ctx = { settings, local, orders, diag }：settings 是 getSettings() 的结果，local 是
// chrome.storage.local 里的运行记录，orders 是批次，diag 是 lib/diag.js 算好的状态列表。

const modules = new Map();

export function registerModule(m) {
  if (!m || !m.id || !/^[a-z][a-z0-9-]*$/.test(m.id)) throw new Error(`模块 id 不合法：${m && m.id}`);
  if (modules.has(m.id)) throw new Error(`模块 id 重复：${m.id}`);
  modules.set(m.id, { order: 100, core: false, ...m });
}

export const listModules = () => [...modules.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
export const getModule = (id) => modules.get(id);

/** 模块有没有开启：设置里没写过的默认开启；必备模块永远开启 */
export function isEnabled(settings, id) {
  const m = modules.get(id);
  if (m && m.core) return true;
  return !(settings.modules && settings.modules[id] === false);
}
