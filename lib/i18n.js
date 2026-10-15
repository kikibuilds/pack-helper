// 界面中英文切换。
// 做法：页面照常用中文渲染，切到英文时把页面上的中文文字（文本、placeholder、title、弹窗）按下面的对照表换成英文；
// 之后新出现的文字（表格重绘、进度、提示）也会自动翻译。切回中文时恢复原文。
// 用户自己填的内容（商品名、SKU、备注等在输入框里）不会被翻译。

const KEY = 'uiLang';
export function getLang() {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}
function storeLang(l) { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } }

// —— 固定文字 ——
const EXACT = {
  // 页头
  '发货助手 · 批次': 'Pack Helper · Batch',
  '发货助手 · 正在执行远程指令': 'Pack Helper · Running remote command',
  '发货批次': 'Shipping batch',
  '选择要拉取哪些平台的订单': 'Choose which platforms to pull orders from',
  '所有平台': 'All platforms',
  '只拉 Poshmark': 'Poshmark only',
  '只拉 Mercari': 'Mercari only',
  '只拉 Depop': 'Depop only',
  '一键拉取所有平台订单（可在左边选择只拉某一个平台）': 'Pull to-ship orders from all platforms (or pick one on the left)',
  '▶ 一键拉取订单': '▶ Pull orders',
  '■ 停止': '■ Stop',
  '正在停止…': 'Stopping…',
  '正在停止，关闭后台打开的标签页…': 'Stopping and closing background tabs…',
  '⬇ 打包下载': '⬇ Pack & download',
  '发给谁（在下方「设置」里添加邮箱）': 'Send to whom (add addresses in Settings below)',
  '打包后直接用 Mac 上的邮件程序发出 zip，页面会显示发送成功或失败': 'Pack, then email the zip through the mail helper on this Mac; the page shows whether it was sent',
  '✉ 打包并发邮件': '✉ Pack & email',
  '清空批次': 'Clear batch',
  '运行期间请保持这个页面打开，Chrome 会在后台开关一些标签页，这是正常的。订单会一边读一边出现在下面的表格里。':
    'Keep this page open while it runs. Chrome will open and close some tabs in the background — that is normal. Orders appear in the table below as they are read.',
  // 待分配面单
  '待分配面单': 'Unassigned labels',
  '这些 PDF 是自动截获或手动抓到的，还没确定属于哪个订单。选择订单后点「分配」。':
    'These PDFs were captured automatically or added by hand but are not matched to an order yet. Pick an order and click "Assign".',
  '分配': 'Assign',
  '丢弃': 'Discard',
  '（已有面单）': '(has label)',
  // 订单表格
  '订单': 'Orders',
  '流程：①「一键拉取订单」把各平台待发货的订单和面单拉到这里 → ② 检查、修改（改过的内容重新拉取时会保留） → ③ 勾选要发的，点「打包下载」生成发货文件。':
    'Flow: ① "Pull orders" brings every platform\'s to-ship orders and labels here → ② check and edit (your edits survive the next pull) → ③ tick what to ship and click "Pack & download".',
  '面单一栏：': 'Label column: ',
  '✓ 已对应': '✓ Matched',
  '可以点「打开」查看；': ' click "Open" to view it; ',
  '缺面单': 'No label',
  '会写原因，可以点「订单页」去平台下载，再「选择」或把 PDF 拖进这一格。':
    ' shows the reason — open the order page to download it, then "Choose" or drag the PDF into that cell.',
  '全选': 'Select all',
  '打包': 'Pack',
  '编号': 'Code',
  '平台': 'Platform',
  '图片': 'Image',
  '商品名': 'Item',
  '数量': 'Qty',
  '订单号': 'Order #',
  '面单': 'Label',
  '无图': 'No image',
  '无': 'none',
  '同上': 'same',
  '打开': 'Open',
  '换一张': 'Replace',
  '选择': 'Choose',
  '订单页↗': 'Order page↗',
  '打开订单页': 'Open order page',
  '+件': '+item',
  '多件订单：同一包裹再加一件商品': 'Multi-item order: add another item to this package',
  '删除': 'Delete',
  '勾选 = 这次打包下载': 'Ticked = include in this pack',
  '之前打包过': 'Packed before',
  '手动添加': 'Added by hand',
  '已手动修改': 'Edited',
  '在批次页手动添加的，重新拉取时不会被删掉': 'Added by hand on this page; a new pull will not remove it',
  '你改过的内容，重新拉取时会保留': 'Your edits are kept when you pull again',
  '去掉这个标记：当作没打包过的新订单': 'Remove this mark: treat as a new, never-packed order',
  '去掉「已打包」标记：当作没打包过的新订单': 'Remove the "packed" mark: treat as a new, never-packed order',
  '（无订单号）': '(no order #)',
  '手动添加的包裹，没有订单号': 'Package added by hand, no order number',
  '批次是空的。点右上角「一键拉取订单」，或者用下面的「手动添加订单」。': 'The batch is empty. Click "Pull orders" at the top right, or use "Add an order by hand" below.',
  // 手动添加
  '＋ 手动添加订单': '＋ Add an order by hand',
  '平台拉不到、或者线下卖出的订单，可以在这里手动加。加进已有包裹的，会和那个包裹装同一个箱子、共用一张面单。':
    'For orders the pull can\'t find, or sales made offline. Items added to an existing package go in the same box and share its label.',
  '打包编号': 'Package',
  '其他': 'Other',
  '可以不填': 'optional',
  '商品名或 SKU 至少填一个': 'Item name or SKU — at least one',
  '商品图片': 'Item photo',
  '面单（PDF 或图片）': 'Label (PDF or image)',
  '添加到批次': 'Add to batch',
  '清空': 'Clear',
  '新包裹（打包时自动编号）': 'New package (code assigned when packing)',
  '这个包裹已经有面单，可以不传': 'This package already has a label — no need to upload one',
  '商品名和 SKU 至少填一个。': 'Enter an item name or a SKU.',
  '数量至少是 1。': 'Quantity must be at least 1.',
  '面单只能是 PDF、PNG 或 JPG。': 'The label must be a PDF, PNG or JPG.',
  '要加入的包裹已经不在批次里了，请刷新页面再试。': 'That package is no longer in the batch. Refresh the page and try again.',
  // 设置
  '设置': 'Settings',
  '发货文件保存位置': 'Where shipping files are saved',
  '发货文件保存在：': 'Shipping files are saved in: ',
  'Chrome 的「下载内容」文件夹': 'Chrome\'s Downloads folder',
  '/ 发货_日期时间 /': '/ 发货_date_time /',
  '这里可以改子文件夹的名字（可以多层，例如': 'You can rename the subfolder here (nested is fine, e.g. ',
  '）。要换整个根目录（比如换到另一个磁盘），请到 Chrome 的「设置 → 下载内容 → 位置」里改 —— Chrome 只允许扩展把文件存在下载文件夹里面。':
    '). To move the whole root (e.g. to another disk), change Chrome\'s Settings → Downloads → Location — Chrome only lets extensions save inside the Downloads folder.',
  '改了子文件夹不影响发邮件。': 'Changing the subfolder does not affect email.',
  '子文件夹': 'Subfolder',
  '自动截获从这几个平台下载的面单 PDF': 'Automatically capture label PDFs downloaded from these platforms',
  '待发货列表页地址': 'To-ship list pages',
  '「一键拉取订单」会依次打开这些页面。第一格填列表页地址（留空表示跳过该平台）；第二格填打开后要先点的筛选按钮上的文字，例如 Depop 的「To ship」。':
    '"Pull orders" opens these pages in turn. First box: the list page URL (leave empty to skip that platform). Second box: the text of a filter button to click first, e.g. "To ship" on Depop.',
  '列表页地址，留空 = 跳过': 'List page URL, empty = skip',
  '先点的按钮（可空）': 'Button to click first (optional)',
  '订单详情链接规则': 'Order detail link patterns',
  '一键拉取时用来识别订单详情链接的规则（正则）。平台改版后读不到时，在这里调整。': 'Regular expressions used to recognize order detail links. Adjust them here if a platform redesign breaks reading.',
  '保存设置': 'Save settings',
  '设置已保存。': 'Settings saved.',
  '邮件': 'Email',
  '「✉ 打包并发邮件」打包后，会直接交给 Mac 上的邮件程序，用下面的': '"✉ Pack & email" packs the batch and hands it to the mail helper on this Mac, which sends it from the ',
  '发件邮箱': 'Sender',
  '发给选中的收件人，页面上会显示发送成功或失败；只点「打包下载」不会发邮件。': ' below to the selected recipient; the page shows whether it was sent. "Pack & download" alone never sends email.',
  '发件邮箱需要是 Gmail，并且在 Mac 上运行过一次这个版本的': 'The sender must be a Gmail address, and this version\'s ',
  '，为这个邮箱保存应用专用密码（换发件邮箱后也要为新邮箱运行一次）。': ' must have been run once on the Mac to save its app password (run it again for any new sender).',
  '收件人（每行一个，最多 5 个，比如你自己和打包同事）：': 'Recipients (one per line, up to 5 — e.g. yourself and whoever packs):',
  '密送（BCC）': 'BCC',
  'example@gmail.com（可留空）': 'example@gmail.com (optional)',
  '每封发货邮件都会悄悄抄一份给这里的邮箱（比如你自己），用来确认已经发出；收件人看不到密送。多个用逗号隔开，最多 3 个。':
    'Every shipping email is quietly copied here (e.g. to yourself) so you can confirm it went out; recipients can\'t see the BCC. Separate several with commas, up to 3.',
  '邮件标题和正文': 'Email subject and body',
  '标题': 'Subject',
  '正文：': 'Body:',
  '可以用这些占位符，发信时会自动换成实际内容：': 'These placeholders are replaced with real values when sending:',
  '预览（用示例订单）：': 'Preview (sample orders):',
  '恢复默认标题和正文': 'Restore default subject and body',
  '保存邮件设置': 'Save email settings',
  '测试邮件连接': 'Test mail connection',
  '打包日期，例如 10/14': 'pack date, e.g. 10/14',
  '包裹个数': 'number of packages',
  '商品总件数': 'total number of items',
  '附件 zip 的文件名': 'file name of the attached zip',
  '有缺面单时变成「⚠ D05 还没有面单，这几个包裹先不要发。」，没有时这一行自动去掉': 'becomes "⚠ D05 has no label yet — hold these packages" when labels are missing; the line disappears otherwise',
  '每个包裹的编号、SKU × 数量、商品名（包裹多时邮件会很长，默认不放）': 'each package\'s code, SKU × qty and item name (long for big batches, so not in the default)',
  '已恢复默认的邮件标题和正文，点「保存邮件设置」后生效。': 'Default subject and body restored — click "Save email settings" to apply.',
  '正在检查邮件程序…': 'Checking the mail helper…',
  '还没有收件人。请在页面下方「设置 → 邮件收件人」里添加邮箱。': 'No recipients yet. Add one under Settings → Email below.',
  '还没有发件邮箱。请在页面下方「设置 → 邮件」里填写。': 'No sender yet. Fill it in under Settings → Email below.',
  '发给以上全部': 'Send to all of the above',
  '（先在设置里添加邮箱）': '(add an address in Settings first)',
  '最多 5 个收件人。': 'At most 5 recipients.',
  '请填写有效的发件邮箱（Gmail）。': 'Enter a valid sender address (Gmail).',
  '密送最多 3 个。': 'At most 3 BCC addresses.',
  '发件邮箱换了的话，记得在 Mac 上为它运行一次 install.sh 保存密码。': 'If you changed the sender, run install.sh on the Mac once for it to save its password.',
  // 远程指令
  '远程指令（邮件触发）': 'Remote commands (by email)',
  '人不在电脑旁时，用手机发一封邮件到': 'When you\'re away from the computer, email the ',
  '（上面「邮件」里那个 Gmail），这台电脑会自动拉取订单、打包、发邮件给下面选的收件人，再回信告诉你结果。':
    ' (the Gmail under "Email" above) from your phone: this computer pulls orders, packs, emails the recipient chosen below, and replies with the result.',
  '前提：这台电脑开着、不睡眠，Chrome 开着，三个平台在 Chrome 里保持登录。发件邮箱、密送、邮件标题和正文和上面「邮件」共用一套。':
    'Requires: this computer on and awake, Chrome open, and all three platforms signed in. Sender, BCC, subject and body are shared with "Email" above.',
  '开启远程指令': 'Enable remote commands',
  '允许的邮箱': 'Allowed senders',
  'example@gmail.com（每行一个，只有这些邮箱发来的指令才会执行）': 'example@gmail.com (one per line; only commands from these addresses run)',
  '暗号': 'Passphrase',
  '至少 4 个字，标题里要带上它': 'at least 4 characters; must appear in the subject',
  '随机生成': 'Generate',
  '检查间隔': 'Check every',
  '每 1 分钟': '1 minute',
  '每 2 分钟': '2 minutes',
  '每 5 分钟': '5 minutes',
  '每 10 分钟': '10 minutes',
  '打包后发给': 'Send pack to',
  '以上全部收件人': 'All recipients above',
  '全部收件人': 'all recipients',
  '（先在上面「邮件」里添加收件人）': '(add recipients under "Email" above first)',
  '远程打包时全选：批次里有面单的订单全部打包，包括之前打包过的（回信里会注明哪几单之前打包过）':
    'Remote pack selects everything: every order in the batch with a label is packed, including ones packed before (the reply lists those)',
  '不勾：只打包表格里勾选的订单，之前打包过的会跳过，避免同一单发两次。': 'Unticked: only orders ticked in the table are packed; previously packed ones are skipped so nothing ships twice.',
  '指令写在邮件': 'Write the command in the email ',
  '里（正文随便写或不写）：': ' (the body can be anything or empty):',
  '保存远程设置': 'Save remote settings',
  '立即检查一次收件箱': 'Check inbox now',
  '远程指令记录': 'Remote command log',
  '还没有收到过远程指令。': 'No remote commands received yet.',
  '时间': 'Time',
  '发件人': 'From',
  '指令': 'Command',
  '结果': 'Result',
  '拉取 + 打包 + 发邮件': 'Pull + pack + email',
  '拉取预览（不打包、不发邮件）': 'Pull preview (no packing, no email)',
  '查看状态': 'Status',
  '重发上次没发出去的发货文件': 'Resend the last pack that failed to send',
  '回信告诉你电脑、平台登录、上次运行的情况': 'replies with the computer, platform sign-in and last-run status',
  '每封指令都会先回一封「收到」，做完再回一封结果；3 小时以前发的指令不会执行。': 'Each command gets a "received" reply first and a result reply when done; commands older than 3 hours are ignored.',
  '正在执行…': 'Running…',
  '已回复状态': 'Status sent',
  '这个页面是远程指令（邮件）自动打开的，正在执行，做完会自动关闭。请不要关它。': 'This page was opened by a remote (email) command and is running. It will close itself when done — please don\'t close it.',
  '远程指令执行完了，这个页面 10 秒后自动关闭。': 'Remote command finished; this page closes in 10 seconds.',
  '有人正在这台电脑上手动拉取，等它结束后再执行远程指令…': 'Someone is pulling orders on this computer; the remote command will run after it finishes…',
  '被手动停止': 'Stopped by hand',
  '远程指令已关闭（设置已保存）。': 'Remote commands are off (settings saved).',
  '远程指令没有开启': 'Remote commands are not enabled',
  '上一次检查还没结束': 'The previous check is still running',
  '还没有填「允许的邮箱」。': '"Allowed senders" is empty.',
  '暗号至少 4 个字。': 'The passphrase needs at least 4 characters.',
  // 已打包记录
  '已打包记录': 'Packed history',
  '打包下载过的订单会被记住（45 天）。之后再拉取时，如果平台上还显示待发货，会标「之前打包过」并默认不勾选，避免重复发货。':
    'Packed orders are remembered for 45 days. If a platform still shows one as to-ship on a later pull, it is marked "Packed before" and left unticked so it doesn\'t ship twice.',
  '清除已打包记录': 'Clear packed history',
  '已清除已打包记录。': 'Packed history cleared.',
  '清除后，之前打包过、但平台上还显示待发货的订单会再次进入发货文件。确定吗？': 'After clearing, orders packed before that still show as to-ship will be packed again. Continue?',
  '清空所有订单、图片和面单？此操作不能撤销。': 'Clear all orders, images and labels? This cannot be undone.',
  '从批次中删除这一行？': 'Remove this row from the batch?',
  '这不是 PDF 或图片文件。': 'That is not a PDF or image file.',
  '没有勾选任何订单。': 'No orders are ticked.',
  '批次是空的。': 'The batch is empty.',
  '已取消。': 'Cancelled.',
  '已停止。已经读取的订单保留在下方表格里；检查后可以直接点「打包下载」。': 'Stopped. Orders already read stay in the table below; check them and click "Pack & download" when ready.',
  '显示还有一次运行没有结束（可能是上次运行时关掉了页面）。\n确定没有其他批次页在运行的话，点「确定」强制重新开始。':
    'Another run appears unfinished (maybe the page was closed mid-run).\nIf no other batch page is running, click OK to start over.',
  // 发邮件状态
  '① 正在打包': '① Packing',
  '② 正在发送邮件': '② Sending email',
  '③ 发送成功 ✅': '③ Sent ✅',
  '③ 发送失败 ❌': '③ Failed ❌',
  '③ 完成': '③ Done',
  '① 正在打包…': '① Packing…',
  '② 正在发送邮件…': '② Sending email…',
  '失败原因：': 'Reason:',
  '↻ 重新发送': '↻ Resend',
  '（用刚才打好的同一个发货文件，不会重新打包）': '(re-sends the same file, no repacking)',
  '未知错误': 'Unknown error',
  // 本次拉取情况 / 上次生成
  '需要注意：': 'Needs attention:',
  '详细诊断（发给开发者用）': 'Detailed diagnostics (for the developer)',
  '× 去掉标记': '× Unmark',
  '已手动停止': 'Stopped by hand',
  '已经有一次运行在进行中': 'A run is already in progress',
  '📖 使用手册': '📖 User guide',
  '不知道怎么做时，看这里的使用手册': 'Not sure how to do something? See the user guide',
  // 页面上的语言按钮
  'English': 'English',
};

// —— 带变量的文字：正则 → 英文（$1、$2 是变量；用函数时可以继续翻译里面的中文） ——
const T = (s) => translate(s);
const PATTERNS = [
  [/^已勾选 (\d+) 个包裹 · (\d+) 件 · (\d+) 个缺面单$/, '$1 packages ticked · $2 items · $3 missing labels'],
  [/^已勾选 (\d+) 个包裹 · (\d+) 件 · 面单齐全$/, '$1 packages ticked · $2 items · all labels in'],
  [/^共 (\d+) 单，已勾选 (\d+) 单，未勾选 (\d+) 单（灰色）$/, '$1 orders, $2 ticked, $3 unticked (grey)'],
  [/^共 (\d+) 单，已勾选 (\d+) 单$/, '$1 orders, $2 ticked'],
  [/^▶ 拉取 (.+) 订单$/, '▶ Pull $1 orders'],
  [/^已打包 (\d+\/\d+ \d+:\d+)$/, 'Packed $1'],
  [/^加进 (\S+) · (.+)$/, (m, a, b) => `Add to ${a === '（未勾选）' ? '(unticked)' : a} · ${b.replace(/^其他/, 'Other').replace(/ · 订单 /, ' · order ')}`],
  [/^(.*)（已有面单）$/, '$1 (has label)'],
  [/^发给 (.+)$/, 'Send to $1'],
  [/^（未勾选）$/, '(unticked)'],
  [/^共 (\d+) 件$/, '$1 items'],
  // 拉取
  [/^将打开 (.+) 的待发货列表，把订单和面单拉到这个页面的表格里（不会自动打包）。$/, (m, a) => `This opens the to-ship list on ${a.replace(/、/g, ', ')} and pulls the orders and labels into the table on this page (nothing is packed automatically).`],
  [/^检查无误后再点「打包下载」。$/, 'Check them, then click "Pack & download".'],
  [/^运行期间请保持本页打开。开始吗？$/, 'Keep this page open while it runs. Start?'],
  [/^拉取完成：没有需要打包的新订单（(\d+) 个问题见下方「本次拉取情况」）。之前打包过的订单在表格里标「已打包」、不勾选。$/, 'Pull finished: no new orders to pack ($1 issues — see "This pull" below). Previously packed orders are marked "Packed" and unticked.'],
  [/^拉取完成：没有需要打包的新订单。之前打包过的订单在表格里标「已打包」、不勾选。$/, 'Pull finished: no new orders to pack. Previously packed orders are marked "Packed" and unticked.'],
  [/^拉取完成：勾选了 (\d+) 个包裹(?:，其中 (\d+) 个缺面单|，面单齐全)(?:，(\d+) 个问题见下方「本次拉取情况」)?。请检查下面的表格，确认后点「⬇ 打包下载」。$/,
    (m, a, b, c) => `Pull finished: ${a} packages ticked${b ? `, ${b} missing labels` : ', all labels in'}${c ? `, ${c} issues (see "This pull" below)` : ''}. Check the table, then click "⬇ Pack & download".`],
  [/^运行中断：(.+)$/, (m, a) => `Run stopped: ${T(a)}`],
  [/^(Poshmark|Mercari|Depop)：打开待发货列表…$/, '$1: opening the to-ship list…'],
  [/^(Poshmark|Mercari|Depop)：已切换到「(.+)」，读取订单列表…$/, '$1: switched to "$2", reading the order list…'],
  [/^(Poshmark|Mercari|Depop)：读取订单 (\d+)\/(\d+)$/, '$1: reading order $2/$3'],
  [/^(Poshmark|Mercari|Depop)：抓取订单 (\d+)\/(\d+) 的面单$/, '$1: fetching the label for order $2/$3'],
  [/^(Poshmark|Mercari|Depop)：处理第 (\d+)\/(\d+) 单$/, '$1: handling order $2/$3'],
  [/^(Poshmark|Mercari|Depop)：下载第 (\d+)\/(\d+) 单的面单$/, '$1: downloading the label for order $2/$3'],
  // 本次拉取情况
  [/^本次拉取情况 · (.+)$/, 'This pull · $1'],
  [/^(Poshmark|Mercari|Depop|eBay)：列表中 (\d+) 单，新加入 (\d+)，已寄出跳过 (\d+)，之前打包过 (\d+)，失败 (\d+)$/, '$1: $2 listed, $3 new, $4 already shipped (skipped), $5 packed before, $6 failed'],
  [/^(Poshmark|Mercari|Depop|eBay) 需要重新登录$/, '$1 needs you to sign in again'],
  [/^(Poshmark|Mercari|Depop|eBay) 需要重新登录（用远程桌面在这台电脑的 Chrome 里登录，然后再发一次指令）$/, '$1 needs you to sign in again (use remote desktop to sign in in Chrome on this computer, then send the command again)'],
  [/^上次打包下载了 (\d+) 个包裹（表格里标「已打包」）$/, 'Last pack: $1 packages (marked "Packed" in the table)'],
  [/^上次生成：(.+?) · (.+?)( · 文件在 (.+)\/)?$/, (m, a, b, c, d) => `Last generated: ${a} · ${T(b)}${d ? ` · saved in ${d}/` : ''}`],
  [/^(\d+) 个包裹 (\d+) 件(.*)$/, (m, a, b, rest) => `${a} packages, ${b} items${rest.replace(/，(\d+) 个缺面单/, ', $1 missing labels').replace(/，(\d+) 个平台需重新登录/, ', $1 platforms need sign-in').replace(/，(\d+) 单读取失败/, ', $1 orders failed').replace(/，(\d+) 条需核对/, ', $1 to review')}`],
  [/^没有新的待发货订单(.*)$/, 'No new to-ship orders$1'],
  // 打包 / 发邮件
  [/^将打包 (\d+) 个包裹、(\d+) 件商品。$/, 'About to pack $1 packages, $2 items.'],
  [/^打包后用 (\S+) 发邮件给：(.+?)(（密送 (.+)）)?$/, (m, a, b, c, d) => `Then email from ${a} to ${b.replace(/、/g, ', ')}${d ? ` (BCC ${d.replace(/、/g, ', ')})` : ''}`],
  [/^⚠ (.+) 还没有面单（打包清单上会标红，提醒员工先不要发）。$/, (m, a) => `⚠ ${a.replace(/、/g, ', ')} have no label yet (flagged red on the packing list so they are held).`],
  [/^⚠ (.+) 之前已经打包过，确定要再打包一次吗？$/, (m, a) => `⚠ ${a.replace(/、/g, ', ')} were packed before — pack them again?`],
  [/^⚠ (.+) 没有商品名。$/, (m, a) => `⚠ ${a.replace(/、/g, ', ')} have no item name.`],
  [/^继续打包并发邮件吗？$/, 'Continue with pack & email?'],
  [/^继续打包下载吗？$/, 'Continue with pack & download?'],
  [/^已打包：(.+)\/（发货 \+ 报告）。(.+)。$/, (m, a, b) => `Packed: ${a}/ (shipping file + report). ${T(b)}.`],
  [/^打包失败：(.+)$/, (m, a) => `Packing failed: ${T(a)}`],
  [/^打包这一步就出错了：(.+)$/, (m, a) => `Packing itself failed: ${T(a)}`],
  [/^保存 (.+) 失败$/, 'Could not save $1'],
  [/^从 (\S+) 发给 (.+?)(（密送 (.+?)）)?，附件 (.+)（([\d.]+) MB）。网络不好时会自动重试，最多约 2 分钟，请别关这个页面。$/,
    (m, a, b, c, d, e, f) => `From ${a} to ${b.replace(/、/g, ', ')}${d ? ` (BCC ${d.replace(/、/g, ', ')})` : ''}, attachment ${e} (${f} MB). Retries automatically on a bad connection, up to about 2 minutes — please keep this page open.`],
  [/^已从 (\S+) 发给 (.+?)(（密送 (.+?)）)?（(\d+:\d+:\d+)）。附件：(.+)$/, (m, a, b, c, d, e, f) => `Sent from ${a} to ${b}${d ? ` (BCC ${d})` : ''} (${e}). Attachment: ${f}`],
  [/^已从 (\S+) 发给 (.+?)(（密送 (.+?)）)?$/, (m, a, b, c, d) => `Sent from ${a} to ${b}${d ? ` (BCC ${d})` : ''}`],
  [/^标题：(.*)$/, 'Subject: $1'],
  [/^✅ 邮件程序已连接（版本 (\d+)）。发件邮箱 (\S+) 已保存密码，可以发信。$/, '✅ Mail helper connected (version $1). A password is saved for $2 — ready to send.'],
  [/^邮件程序已连接（版本 (\d+)）。发件邮箱 (\S+) 已保存密码，可以发信。$/, 'Mail helper connected (version $1). A password is saved for $2 — ready to send.'],
  [/^❌ 检查没通过：$/, '❌ Check failed:'],
  [/^❌ 检查失败：$/, '❌ Check failed:'],
  [/^这些不是有效的邮箱：(.+)$/, (m, a) => `These are not valid email addresses: ${a.replace(/、/g, ', ')}`],
  [/^密送里这些不是有效的邮箱：(.+)$/, (m, a) => `These BCC addresses are not valid: ${a.replace(/、/g, ', ')}`],
  [/^已保存：发件邮箱 (\S+)，(\d+) 个收件人(，每封都密送 (.+?))?。(.*)$/, (m, a, b, c, d, e) => `Saved: sender ${a}, ${b} recipients${d ? `, every email BCC'd to ${d.replace(/、/g, ', ')}` : ''}.${e ? ` ${T(e)}` : ''}`],
  [/^(.+) 的规则不是合法的正则表达式$/, '$1: the pattern is not a valid regular expression'],
  [/^已去掉「已打包」标记（(\d+) 行），现在已勾选。$/, 'Removed the "packed" mark ($1 rows); now ticked.'],
  [/^去掉「已打包」标记？$/, 'Remove the "packed" mark?'],
  [/^去掉后这一单会自动勾选，下次拉取也不会再标「之前打包过」，打包时会再打进发货文件。$/, 'The order will be ticked, won\'t be marked "Packed before" on the next pull, and will be included when you pack.'],
  [/^去掉 (\S+)（订单 (\S+)）的「已打包」标记？$/, 'Remove the "packed" mark from $1 (order $2)?'],
  [/^去掉后下次拉取不会再标「之前打包过」，会当作新订单自动勾选。$/, 'It won\'t be marked "Packed before" on the next pull and will be ticked as a new order.'],
  [/^已去掉 (\S+)（订单 (\S+)）的「已打包」标记。$/, 'Removed the "packed" mark from $1 (order $2).'],
  [/^已添加「(.+)」(到所选包裹|（新包裹）)(，面单已对应|，还没有面单（可以之后在表格里拖进去）)。$/,
    (m, a, b, c) => `Added "${a}"${b === '到所选包裹' ? ' to the chosen package' : ' (new package)'}${c === '，面单已对应' ? ', label matched' : ', no label yet (you can drag one into the table later)'}.`],
  // 远程指令
  [/^上次检查收件箱：(.+?)，正常$/, 'Last inbox check: $1, OK'],
  [/^上次检查收件箱：(.+?)，失败：(.+)$/, (m, a, b) => `Last inbox check: ${a}, failed: ${T(b)}`],
  [/^✅ 收件箱检查正常：新指令 (\d+) 个(，忽略 (\d+) 个（见下方记录）)?。$/, (m, a, b, c) => `✅ Inbox OK: ${a} new commands${c ? `, ${c} ignored (see the log below)` : ''}.`],
  [/^ℹ (.+)$/, (m, a) => `ℹ ${T(a)}`],
  [/^：每次都先把全部平台重新拉一遍（最新状态），再打包、发邮件$/, ': always re-pulls every platform first (latest state), then packs and emails'],
  [/^：拉取全部平台，回信列出会打包哪些订单、缺不缺面单、有没有平台要重新登录$/, ': pulls every platform and replies with what would be packed, missing labels and any sign-in problems'],
  [/^(拉取 \+ 打包 \+ 发邮件|拉取预览（不打包、不发邮件）)(：.+)$/, (m, a, b) => `${T(a)}${T(b)}`],
  [/^还不能开启远程指令，下面这些没填好：$/, 'Remote commands can\'t be enabled yet — these are missing:'],
  [/^· 上面「邮件」里的发件邮箱（填好后点「保存邮件设置」）$/, '· Sender under "Email" above (then click "Save email settings")'],
  [/^· 允许的邮箱（至少一个）$/, '· Allowed senders (at least one)'],
  [/^· 暗号（至少 4 个字，可以点「随机生成」）$/, '· Passphrase (at least 4 characters, or click "Generate")'],
  [/^· 打包后发给（先在上面「邮件」里添加收件人并保存，再在这里选）$/, '· Send pack to (add and save recipients under "Email" first, then pick one here)'],
  [/^暗号「(.+)」容易在普通邮件标题里碰巧出现（不分大小写，标题里包含就算，比如 SHIP 会匹配 Shipping \/ Shipped），可能误触发打包。$/, 'The passphrase "$1" could easily appear in an ordinary subject (case-insensitive substring match — SHIP matches Shipping / Shipped) and trigger a pack by accident.'],
  [/^建议点「随机生成」换一个。确定还是用这个吗？$/, 'Click "Generate" for a safer one. Use this one anyway?'],
  [/^远程指令已开启并保存：每 (\d+) 分钟查一次收件箱，打包后发给 (.+?)。可以用 (\S+) 发一封标题为「(.+)」的邮件到 (\S+) 试试。$/,
    (m, a, b, c, d, e) => `Remote commands enabled and saved: the inbox is checked every ${a} minutes and packs go to ${T(b)}. Try it: email ${e} from ${c} with the subject "${d.replace(/ 状态$/, ' 状态')}".`],
  [/^正在检查收件箱…（用的是已保存的设置，改了设置请先保存）$/, 'Checking the inbox… (uses the saved settings — save first if you changed anything)'],
  [/^正在执行远程指令：(.+?)（(\S+)）。做完会自动关闭这个页面，请不要关它。$/, (m, a, b) => `Running remote command: ${T(a)} (${b}). This page closes itself when done — please don't close it.`],
  [/^［远程指令］(.+)$/, (m, a) => `[Remote] ${T(a)}`],
  [/^开始执行…$/, 'Starting…'],
  [/^排队中（前面还有 (\d+) 个）$/, 'Queued ($1 ahead)'],
  [/^已忽略：(.+)$/, (m, a) => `Ignored: ${T(a)}`],
  [/^发件人验证没通过（DKIM\/DMARC），可能是冒充你邮箱的邮件，已忽略$/, 'Sender verification failed (DKIM/DMARC) — possibly spoofed, ignored'],
  [/^邮件缺少 Gmail 的发件人验证结果$/, 'The email has no Gmail sender-verification result'],
  [/^这封指令是 (\d+) 小时 (\d+) 分钟前发的，超过 (\d+) 小时，没有执行$/, 'This command was sent $1 h $2 min ago, more than $3 hours, so it was not run'],
  [/^回复失败：(.+)$/, (m, a) => `Reply failed: ${T(a)}`],
  [/^（回信失败：(.+)）$/, (m, a) => `(reply failed: ${T(a)})`],
  [/^已打包 (\d+) 个包裹、(\d+) 件商品，已发给 (.+)$/, (m, a, b, c) => `Packed ${a} packages, ${b} items, sent to ${c.replace(/、/g, ', ')}`],
  [/^已打包 (\d+) 个包裹、(\d+) 件商品，但邮件没发出去：(.+)$/, (m, a, b, c) => `Packed ${a} packages, ${b} items, but the email failed: ${T(c)}`],
  [/^拉取完成：可打包 (\d+) 个包裹，缺面单 (\d+) 个(，(\d+) 个问题)?$/, (m, a, b, c, d) => `Pull finished: ${a} packages ready, ${b} missing labels${d ? `, ${d} issues` : ''}`],
  [/^没有可打包的订单(，(\d+) 个问题)?$/, (m, a, b) => `Nothing to pack${b ? `, ${b} issues` : ''}`],
  [/^没有设置打包后发给谁$/, '"Send pack to" is not set'],
  [/^没有需要重发的$/, 'Nothing to resend'],
  [/^已重发给 (.+)$/, (m, a) => `Resent to ${a.replace(/、/g, ', ')}`],
  [/^重发失败：(.+)$/, (m, a) => `Resend failed: ${T(a)}`],
  [/^出错：(.+)$/, (m, a) => `Error: ${T(a)}`],
  // 邮件程序 / 连接错误
  [/^Mac 上还没有装邮件程序（或装的是旧版）。请在「终端」运行这个版本里的 mailer\/install\.sh，装完回到这里点「测试邮件连接」。$/, 'The mail helper is not installed on this Mac (or it is an old version). Run mailer/install.sh from this version in Terminal, then come back and click "Test mail connection".'],
  [/^邮件程序不认识这个扩展（扩展 ID 不对）。请重新运行这个版本里的 mailer\/install\.sh。$/, 'The mail helper does not recognize this extension (wrong extension ID). Run mailer/install.sh from this version again.'],
  [/^邮件程序启动后意外退出（(.+)）。请看日志 (.+)；如果日志是空的，重新运行一次 mailer\/install\.sh。$/, 'The mail helper exited unexpectedly ($1). See the log at $2; if it is empty, run mailer/install.sh again.'],
  [/^扩展缺少「与本机程序通信」的权限，请在 chrome:\/\/extensions 重新加载这个扩展。$/, 'The extension lacks the native messaging permission — reload it in chrome://extensions.'],
  [/^等了 3 分钟邮件程序还没回应（可能网络很慢或 Gmail 卡住了）。请稍后点「重新发送」，或看日志 mailer\.log。$/, 'No answer from the mail helper after 3 minutes (slow network or Gmail stuck). Click "Resend" later, or check mailer.log.'],
  [/^邮件程序没有返回结果。请看日志 mailer\.log。$/, 'The mail helper returned nothing. Check mailer.log.'],
  [/^Mac 上的邮件程序是旧版（版本 (\d+)），不支持密送。(.+)$/, 'The mail helper on this Mac is old (version $1) and can\'t BCC. Run bash ~/pack-helper/mailer/install.sh again in Terminal, then click "Resend".'],
  [/^Mac 上的邮件程序是旧版，还不会检查收件箱。(.+)$/, 'The mail helper on this Mac is old and can\'t check the inbox yet. Run bash ~/pack-helper/mailer/install.sh (from the pack-helper folder) in Terminal, then click "Check inbox now".'],
  [/^读取钥匙串失败：(.+)$/, 'Could not read the Keychain: $1'],
  [/^Mac 钥匙串里没有发件邮箱 (\S+) 的 Gmail 应用专用密码。(.*)$/, 'No Gmail app password for $1 in the Mac Keychain. Run mailer/install.sh in Terminal, enter $1 as the sender and paste its app password.'],
  [/^Gmail 拒绝登录 (\S+)：应用专用密码不对或已经失效（(\d+)）。(.*)$/, 'Gmail rejected the sign-in for $1: the app password is wrong or revoked ($2). Create a new one at https://myaccount.google.com/apppasswords and run install.sh again.'],
  [/^连不上 Gmail 服务器，试了 4 次（465 和 587 端口）都失败，邮件没有发出。请检查网络（关掉 VPN \/ 代理试试），然后点「重新发送」。$/, 'Could not reach Gmail after 4 tries (ports 465 and 587); nothing was sent. Check the network (try without VPN/proxy), then click "Resend".'],
  [/^(465|587) 端口：(.+)$/, 'Port $1: $2'],
  [/^收件人被 Gmail 拒绝：(.+)$/, 'Gmail refused the recipients: $1'],
  [/^Gmail 拒收这封邮件（(\d+)）：(.+)$/, 'Gmail refused the message ($1): $2'],
  [/^已经连上 Gmail，但上传邮件时网络断了：(.+?)。(.*)$/, 'Connected to Gmail but the network dropped during upload: $1. The email may or may not have gone out — check the sender\'s Sent folder or your BCC mailbox before resending.'],
  [/^Gmail 拒绝读取收件箱（(.+)）。(.*)$/, 'Gmail refused inbox access ($1). Make sure the app password is still valid; if you just changed it, run install.sh again.'],
  [/^连不上 Gmail 收件箱（imap\.gmail\.com:993），请检查网络：(.+)$/, 'Could not reach the Gmail inbox (imap.gmail.com:993), check the network: $1'],
  [/^发件邮箱格式不对：(.+?)(，请在扩展「设置 → 邮件」里填写。)?$/, (m, a, b) => `Invalid sender address: ${a === '（空）' ? '(empty)' : a}${b ? ' — fill it in under Settings → Email.' : ''}`],
  [/^还没有设置「允许发指令的邮箱」。$/, '"Allowed senders" is not set.'],
  [/^暗号太短（至少 4 个字），请在设置里改一下。$/, 'The passphrase is too short (at least 4 characters) — change it in Settings.'],
  [/^没有有效的收件人，请在扩展「设置 → 邮件」里添加。$/, 'No valid recipients — add them under Settings → Email.'],
  [/^密送邮箱格式不对：(.+)$/, 'Invalid BCC address: $1'],
  [/^发货文件有 ([\d.]+) MB，超过 Gmail 附件上限（25MB），没法用邮件发送。(.*)$/, 'The shipping file is $1 MB, over Gmail\'s 25 MB attachment limit, so it can\'t be emailed. Copy it from this computer instead.'],
  [/^未知操作：(.+)$/, 'Unknown action: $1'],
  [/^邮件程序出错：(.+)$/, 'Mail helper error: $1'],
  // 面单抓取原因（表格里「缺面单」下面的小字）
  [/^页面上没找到「打印\/下载面单」按钮(.*)$/, 'No "print/download label" button found on the page'],
  [/^页面上没有「打印面单」按钮（这单可能还没买面单，扩展不会替你购买）(.*)$/, 'No "print label" button on the page (the label may not be bought yet — the extension never buys one)'],
  [/^这一行没有「Download shipping label」按钮$/, 'This row has no "Download shipping label" button'],
  [/^列表页丢失后重新打开失败$/, 'The list page was lost and could not be reopened'],
  [/^没有新标签页，也没有下载(.*)$/, 'No new tab and no download$1'],
  [/^下载被中断$/, 'Download interrupted'],
  [/^没读到商品名(.*)$/, 'Could not read the item name'],
  // 提示里的小片段
  [/^(.+)：自动抓取失败（(.+)），请在批次页手动拖入。$/, '$1: automatic capture failed ($2) — drag it in on the batch page.'],
  [/^已自动把面单 (.+) 配给 (.+)$/, 'Label $1 matched to $2 automatically'],
  [/^已截获面单 (.+)，请在批次页分配给对应订单。$/, 'Captured label $1 — assign it to an order on the batch page.'],
];

/** 翻译一行文字（找不到对照时原样返回） */
function translateLine(line) {
  const lead = line.match(/^\s*/)[0];
  const tail = line.match(/\s*$/)[0];
  const core = line.trim();
  if (!core || !/[一-鿿]/.test(core)) return line;
  if (Object.prototype.hasOwnProperty.call(EXACT, core)) return lead + EXACT[core] + tail;
  for (const [re, rep] of PATTERNS) {
    if (!rep) continue;
    const m = core.match(re);
    if (m) return lead + (typeof rep === 'function' ? rep(...m) : core.replace(re, rep)) + tail;
  }
  return line;
}

/** 翻译任意文字（多行的逐行翻） */
export function translate(text) {
  if (text == null) return text;
  const s = String(text);
  if (getLang() !== 'en' || !/[一-鿿]/.test(s)) return s;
  return s.split('\n').map(translateLine).join('\n');
}

// —— 页面翻译 ——
const originals = new WeakMap(); // 文本节点 → 中文原文
const attrOriginals = new WeakMap(); // 元素 → { placeholder, title }
let applying = false;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const p = node.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('[data-noi18n]')) return;
    const cur = node.nodeValue;
    if (getLang() === 'en') {
      if (!/[一-鿿]/.test(cur)) return;
      const t = translate(cur);
      if (t !== cur) { originals.set(node, cur); node.nodeValue = t; }
    } else if (originals.has(node)) {
      node.nodeValue = originals.get(node);
      originals.delete(node);
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest('[data-noi18n]')) return;
  // 输入框、代码块：只翻提示文字（placeholder / title），不动里面的内容
  for (const attr of ['placeholder', 'title']) {
    if (!node.hasAttribute || !node.hasAttribute(attr)) continue;
    const saved = attrOriginals.get(node) || {};
    const cur = node.getAttribute(attr);
    if (getLang() === 'en') {
      if (/[一-鿿]/.test(cur)) {
        const t = translate(cur);
        if (t !== cur) { saved[attr] = cur; attrOriginals.set(node, saved); node.setAttribute(attr, t); }
      }
    } else if (saved[attr] != null) {
      node.setAttribute(attr, saved[attr]);
      delete saved[attr];
    }
  }
  if (SKIP.has(node.tagName)) return;
  for (const child of node.childNodes) translateNode(child);
}

function applyAll() {
  applying = true;
  try {
    translateNode(document.body);
    if (getLang() === 'en') {
      if (!originals.has(document)) originals.set(document, document.title);
      document.title = translate(originals.get(document));
    } else if (originals.has(document)) {
      document.title = originals.get(document);
    }
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
  } finally { applying = false; }
}

export function setLang(l) {
  storeLang(l === 'en' ? 'en' : 'zh');
  applyAll();
  // 使用手册：中文界面打开中文说明，英文界面打开英文说明
  const manual = document.getElementById('lnkManual');
  if (manual) manual.href = getLang() === 'en'
    ? 'https://github.com/kikibuilds/pack-helper/blob/main/README.en.md'
    : 'https://github.com/kikibuilds/pack-helper#readme';
  const btn = document.getElementById('btnLang');
  if (btn) btn.textContent = getLang() === 'en' ? '中文' : 'English';
}

/** 在页面上启用：翻译现有内容、监视新内容、包装 alert / confirm */
export function initI18n() {
  const origAlert = window.alert.bind(window);
  const origConfirm = window.confirm.bind(window);
  window.alert = (m) => origAlert(translate(m));
  window.confirm = (m) => origConfirm(translate(m));
  new MutationObserver((muts) => {
    if (applying || getLang() !== 'en') return;
    applying = true;
    try {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
      if (/[一-鿿]/.test(document.title)) { originals.set(document, document.title); document.title = translate(document.title); }
    } finally { applying = false; }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
  setLang(getLang());
}
