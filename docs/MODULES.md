# 功能模块（V0.7 起）

发货助手的每个功能都是一个**模块**：首页的卡片、「需要处理」里的提醒、页面导航、「⚙ 设置 → 功能管理」里的开关，都由模块的说明自动生成。加一个功能 = 多写一个模块，外壳（`core/`）不用改。

```
pack-helper/
├─ batch.html          页面：首页 + 各功能页面（内置模块的界面都在这里）
├─ batch.js            内置模块（发货 / 远程指令 / 运行监控）的逻辑
├─ core/
│   ├─ registry.js     模块注册表：registerModule()、isEnabled()
│   └─ shell.js        外壳：首页、页面切换、功能管理、顶栏进度
├─ modules/            公开的内置模块
│   ├─ index.js        内置模块清单
│   ├─ shipping/       🚚 发货（必备）
│   ├─ remote/         📨 远程指令
│   └─ monitor/        🩺 运行监控
└─ modules-private/    你自己的模块（公开版里只有两个空文件）
    ├─ index.js        页面部分的清单
    └─ background.js   后台部分（定时任务、消息）的清单
```

## 写一个模块

在 `modules-private/` 里建一个文件夹，比如 `modules-private/hello/module.js`：

```js
export default {
  id: 'hello',                  // 唯一英文名（小写字母、数字、-），也是地址：#/hello
  name: '示例',                 // 首页卡片、顶栏上显示的名字
  icon: '👋',
  desc: '首页卡片上的一句话简介',
  order: 50,                    // 排序，内置模块是 10 / 20 / 30
  private: true,                // 功能管理里标「私有」（可选）

  // 自己画界面：外壳会建一个空页面，把它交给你
  mount(el) {
    el.innerHTML = '<div class="panel"><h3>示例</h3><button class="primary">做点什么</button></div>';
    el.querySelector('button').addEventListener('click', () => alert('hi'));
  },

  // 首页卡片底部的状态：level = ok（绿）/ warn（黄）/ bad（红）/ off（灰）
  status(ctx) { return { level: 'ok', text: '运行中' }; },

  // 首页「需要处理」：返回空数组表示没事
  todos(ctx) { return []; },

  // （可选）往别的功能页面里加子页面，比如往「运行监控」加一页记录
  panes: [{ view: 'monitor', id: 'hello-log', title: '示例记录', mount(el) { el.textContent = '……'; } }],

  // （可选）在功能管理里被打开 / 关掉时调用
  async onToggle(on) {},
};
```

然后在 `modules-private/index.js` 里登记（这个文件公开版里是空的，直接改）：

```js
import { registerModule } from '../core/registry.js';
import hello from './hello/module.js';

registerModule(hello);
```

在 `chrome://extensions` 点发货助手的 ↻ 重新加载，首页就会多一张「👋 示例」卡片，「⚙ 设置 → 功能管理」里也能开关它。

### ctx 里有什么

`status(ctx)` 和 `todos(ctx)` 拿到的 `ctx`：

| 字段 | 内容 |
|---|---|
| `ctx.settings` | `getSettings()` 的结果（`lib/store.js`）。自己模块的设置建议放在 `settings.<模块 id>` 下面 |
| `ctx.local` | `chrome.storage.local` 里的运行记录：`lastScan`、`lastRun`、`lastMail`、`remoteLastPoll`、`heartbeatLast`、`loginCheckLast` 等 |
| `ctx.orders` | 批次里的订单 |
| `ctx.diag` | `lib/diag.js` 算好的状态列表 `[{ name, level, text }]`（各平台登录、心跳、远程指令……） |

`todos` 返回 `[{ level, title, detail, route }]`，`route` 是点击后去的地址，比如 `'#/hello'`。

### 样式

页面已经有一套现成的样式（`batch.css`），直接用这些 class 就和其他页面一致：`panel`（白色卡片）、`row`（一排按钮）、`muted`（灰色说明文字）、`patrow`（左标签右输入框）、`check`（勾选框一行）、按钮的 `primary`（蓝）/ `go`（绿）/ `danger`（红字）、提示框 `note` / `note warn`、状态框 `mailstatus ok` / `mailstatus fail`。

### 关掉一个模块会怎样

「功能管理」里关掉后：首页卡片和「需要处理」不再显示它，地址 `#/<id>` 会回到首页，设置里记 `settings.modules.<id> = false`。内置的远程指令、运行监控关掉时，后台的定时任务（查收件箱、心跳、登录检查）也会停（`lib/remote.js`、`lib/health.js` 里用 `moduleOn()` 判断）。

## 后台部分（定时任务）

需要在后台定时运行的（比如每 30 分钟同步一次），另写一个 `background.js`，登记到 `modules-private/background.js`：

```js
// modules-private/hello/background.js
import { getSettings } from '../../lib/store.js';

export default {
  id: 'hello',                                   // 和页面部分的 id 一样
  alarms: { helloTick: (alarm) => doWork() },    // 定时器名字 → 要做的事
  messages: { helloNow: (msg) => doWork() },     // 页面里 chrome.runtime.sendMessage({ type: 'helloNow' }) → 返回值回给页面
  async schedule() {                             // 按设置排定时器（开机、改设置、功能管理里打开时调用）
    const s = await getSettings();
    await chrome.alarms.clear('helloTick');
    if (s.hello && s.hello.enabled) await chrome.alarms.create('helloTick', { periodInMinutes: 30 });
  },
  watch: (oldS, newS) => JSON.stringify(oldS.hello) !== JSON.stringify(newS.hello), // 哪些设置变了要重新排
};
```

```js
// modules-private/background.js
import hello from './hello/background.js';
export default [hello];
```

在「功能管理」里关掉这个模块时，外壳会自动清掉它 `alarms` 里的定时器，也不会再调用它的 `alarms` / `messages`。

### 中英文

模块自己的文字，用 `addTranslations` 补英文对照（`lib/i18n.js`）：

```js
import { addTranslations } from '../../lib/i18n.js';
addTranslations({ '示例记录': 'Demo log' }, [[/^同步了 (\d+) 单$/, 'Synced $1 orders']]);
```

子页面（`panes`）和模块页面每次显示时，如果写了 `onShow`，会被调用一次，可以用来刷新内容。

## 目前的限制

- **不能从网上安装**：Chrome 不允许扩展从网上下载代码来运行（Manifest V3 的安全规定），所以「安装」一个模块 = 把它的文件夹放进插件目录（复制，或者 `git pull`），再在 `chrome://extensions` 重新加载。
- 模块加载出错时，首页「需要处理」会提示「私有模块加载出错」，其他功能照常能用。

## 私有模块怎么和公开版一起用

做一个私有仓库，内容 = 公开版 + 你在 `modules-private/` 里加的东西（再在 `manifest.json` 里加一行 `"version_name": "x.y.z-private"`，各处显示的版本号就能和公开版区分）。因为私有的东西都只在 `modules-private/` 里，公开版更新时直接合并，不会冲突：

```bash
cd ~/pack-helper-private
git remote add upstream https://github.com/kikibuilds/pack-helper.git   # 只需要做一次
git pull upstream main                                                  # 拿公开版的更新
git push
```
