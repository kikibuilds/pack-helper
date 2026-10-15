#!/bin/bash
# 发货邮件程序 · 安装（macOS）
# 用法：在「终端」里运行   bash install.sh
# 作用：① 把发件邮箱的 Gmail 应用专用密码存进钥匙串 ② 让 Chrome 里的发货助手能直接调用这个邮件程序
# 要用几个发件邮箱，就为每个运行一次（之前保存的密码不会丢）。
set -euo pipefail

APP="${HOME}/Library/Application Support/PackHelperMailer"
SERVICE="PackHelperMailer"
HOST_NAME="com.plushify.packhelper"
EXT_ID="ohpffalnkclojleccgidgjnlggnpjfab"   # 发货助手的扩展 ID（固定）
HERE="$(cd "$(dirname "$0")" && pwd)"
EMAIL_RE='^[^@[:space:],;]+@[^@[:space:],;]+\.[A-Za-z]{2,}$'

echo "=== 发货邮件程序 安装 ==="

PY=/usr/bin/python3
if ! "${PY}" -c 'import sys; assert sys.version_info >= (3, 8)' 2>/dev/null; then
  echo "需要 Python 3。请先在终端运行：xcode-select --install ，装好后再运行本脚本。"
  exit 1
fi

# 发件邮箱：填扩展「设置 → 邮件 → 发件邮箱」里的那个 Gmail
SENDER=""
while ! printf '%s' "${SENDER}" | grep -Eq "${EMAIL_RE}"; do
  read -r -p "发件邮箱（Gmail，和扩展「设置 → 邮件 → 发件邮箱」一致，例如 example@gmail.com）: " SENDER
done

echo
echo "接下来需要 ${SENDER} 的 Gmail「应用专用密码」（16 位，不是平时的登录密码）。"
echo "获取方法：用该账号登录 https://myaccount.google.com/apppasswords （账号需先开启两步验证）。"
read -r -s -p "粘贴应用专用密码（输入时不显示）: " PW
echo
PW="${PW// /}"
if [ ${#PW} -ne 16 ]; then
  echo "应用专用密码应为 16 位字母（去掉空格后），请检查后重新运行。"
  exit 1
fi
security add-generic-password -U -s "${SERVICE}" -a "${SENDER}" -w "${PW}" >/dev/null
unset PW
echo "✓ 密码已存入钥匙串（${SENDER}）"

# 程序文件
mkdir -p "${APP}"
# 只复制文件内容（不用 cp：cp 会连带复制「从网上下载」的隐藏标记，有的 Mac 上会被拒绝）
if ! "${PY}" - "${HERE}/send_packages.py" "${APP}/send_packages.py" <<'PYEOF'
import os, sys
src, dst = sys.argv[1:3]
try:
    data = open(src, "rb").read()
except OSError as e:
    print(f"读取 {src} 失败：{e}")
    sys.exit(1)
try:
    if os.path.exists(dst):
        os.remove(dst)
    open(dst, "wb").write(data)
    os.chmod(dst, 0o755)
except OSError as e:
    print(f"写入 {dst} 失败：{e}")
    sys.exit(1)
PYEOF
then
  echo
  echo "复制邮件程序失败。通常是 macOS 不让「终端」读写这个文件夹，任选一种办法后重新运行本脚本："
  echo "  ① 打开「系统设置 → 隐私与安全性 → 文件与文件夹」，给「终端」打开「下载」文件夹的权限；"
  echo "     或在「完全磁盘访问权限」里打开「终端」，然后完全退出终端（⌘Q）再打开。"
  echo "  ② 或者把整个 pack-helper 文件夹从「下载」拖到「文稿」或桌面以外的个人文件夹（比如 ~/pack-helper），再从那里运行。"
  exit 1
fi
cat > "${APP}/packhelper_host" <<EOF
#!/bin/bash
exec /usr/bin/python3 "${APP}/send_packages.py" native "\$@"
EOF
chmod +x "${APP}/packhelper_host"

# 配置：记下已保存密码的发件邮箱（测试邮件也用它）
read -r -p "测试邮件发到哪个邮箱（直接回车 = 发给 ${SENDER} 自己）: " TESTTO
TESTTO="${TESTTO:-${SENDER}}"
if ! printf '%s' "${TESTTO}" | grep -Eq "${EMAIL_RE}"; then TESTTO="${SENDER}"; fi
"${PY}" - "${APP}/config.json" "${SENDER}" "${TESTTO}" <<'PYEOF'
import json, sys
path, sender, testto = sys.argv[1:4]
try:
    cfg = json.load(open(path, encoding="utf-8"))
except Exception:
    cfg = {}
senders = [s for s in cfg.get("senders", []) if s != sender] + [sender]
cfg.update({"sender": sender, "recipients": [testto], "senders": senders})
for k in ("watch_dir", "send_all_reports", "max_attach_mb"):  # 旧版文件夹监视的设置，不再需要
    cfg.pop(k, None)
open(path, "w", encoding="utf-8").write(json.dumps(cfg, ensure_ascii=False, indent=2))
PYEOF

# 让 Chrome 能调用这个邮件程序（Native Messaging）
MANIFEST=$(cat <<EOF
{
  "name": "${HOST_NAME}",
  "description": "发货助手 · 邮件程序",
  "path": "${APP}/packhelper_host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXT_ID}/"]
}
EOF
)
INSTALLED=0
for BROWSER_DIR in "Google/Chrome" "Google/Chrome Beta" "Chromium" "Microsoft Edge" "BraveSoftware/Brave-Browser"; do
  BASE="${HOME}/Library/Application Support/${BROWSER_DIR}"
  if [ -d "${BASE}" ]; then
    mkdir -p "${BASE}/NativeMessagingHosts"
    printf '%s\n' "${MANIFEST}" > "${BASE}/NativeMessagingHosts/${HOST_NAME}.json"
    INSTALLED=1
  fi
done
if [ ${INSTALLED} -eq 0 ]; then
  mkdir -p "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  printf '%s\n' "${MANIFEST}" > "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
fi
echo "✓ 已让 Chrome 能直接调用邮件程序"

# 旧版（V0.1.20 及以前）的文件夹监视：停掉，避免重复发信
OLD_PLIST="${HOME}/Library/LaunchAgents/com.plushify.packhelper.mailer.plist"
if [ -f "${OLD_PLIST}" ]; then
  launchctl bootout "gui/$(id -u)" "${OLD_PLIST}" 2>/dev/null || true
  rm -f "${OLD_PLIST}"
  echo "✓ 已停用旧版的文件夹监视"
fi

echo
read -r -p "现在发一封测试邮件到 ${TESTTO} 吗？[Y/n]: " T
if [ "${T:-Y}" != "n" ] && [ "${T:-Y}" != "N" ]; then
  "${PY}" "${APP}/send_packages.py" test || true
fi

cat <<EOF

=== 安装完成 ===
已保存密码的发件邮箱：${SENDER}（要再加一个发件邮箱，重新运行本脚本即可）
回到 Chrome，打开发货助手的批次页 → 设置 → 邮件，点「测试邮件连接」确认。
以后点「✉ 打包并发邮件」，页面上会直接显示「正在发送 / 发送成功 / 发送失败（原因）」。

日志：${APP}/mailer.log
卸载：bash "${HERE}/uninstall.sh"
EOF
