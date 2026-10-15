#!/bin/bash
# 发货邮件程序 · 卸载
set -uo pipefail
APP="${HOME}/Library/Application Support/PackHelperMailer"
HOST_NAME="com.plushify.packhelper"

# Chrome 等浏览器里的注册
for BROWSER_DIR in "Google/Chrome" "Google/Chrome Beta" "Chromium" "Microsoft Edge" "BraveSoftware/Brave-Browser"; do
  rm -f "${HOME}/Library/Application Support/${BROWSER_DIR}/NativeMessagingHosts/${HOST_NAME}.json"
done
# 旧版的文件夹监视（如果还在）
OLD_PLIST="${HOME}/Library/LaunchAgents/com.plushify.packhelper.mailer.plist"
launchctl bootout "gui/$(id -u)" "${OLD_PLIST}" 2>/dev/null
rm -f "${OLD_PLIST}"
# 删除所有保存过的发件邮箱密码（可能有好几个）
for _ in $(seq 1 20); do
  security delete-generic-password -s PackHelperMailer >/dev/null 2>&1 || break
done
rm -rf "${APP}"
echo "已卸载：邮件程序、钥匙串里所有发件邮箱的密码和配置都已删除。发货文件保留未动。"
