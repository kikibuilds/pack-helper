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
└─ modules-private/    你自己的模块（已在 .gitignore 里，不会进公开仓库）
    └─ index.js        私有模块清单（有就加载，没有就跳过）
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

然后在 `modules-private/index.js` 里登记：

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

## 目前的限制

- **后台定时任务**：私有模块现在只能做「页面里」的事。需要在后台定时运行（`chrome.alarms`）的私有模块，还要在 `background.js` 里加几行，以后会做成模块自己登记。
- **不能从网上安装**：Chrome 不允许扩展从网上下载代码来运行（Manifest V3 的安全规定），所以「安装」一个模块 = 把它的文件夹放进插件目录（复制，或者 `git pull`），再在 `chrome://extensions` 重新加载。
- 插件没有 `modules-private/` 时，Chrome 控制台会有一行「Failed to load resource」，是正常的（外壳在试着加载私有模块）。

## 私有模块怎么和公开版一起用

公开版放在 `~/pack-helper`（`git clone` 公开仓库）。私有模块单独放一个仓库，克隆到 `~/pack-helper/modules-private/`：

```bash
cd ~/pack-helper
git clone https://github.com/<你>/<私有模块仓库>.git modules-private
```

两边各自 `git pull` 更新，互不冲突：公开仓库忽略 `modules-private/`，私有仓库里只有你自己的模块。
