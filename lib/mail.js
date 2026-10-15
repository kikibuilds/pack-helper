// 通过 Chrome Native Messaging 直接调用 Mac 上的邮件程序（mailer/install.sh 安装），当场拿到成功 / 失败结果。
import { bytesToBase64 } from './b64.js';

export const HOST = 'com.plushify.packhelper';

/** 把 Chrome 的英文报错翻译成能看懂、知道怎么处理的中文 */
function explain(msg) {
  const m = String(msg || '');
  if (/not found/i.test(m)) {
    return 'Mac 上还没有装邮件程序（或装的是旧版）。请在「终端」运行这个版本里的 mailer/install.sh，装完回到这里点「测试邮件连接」。';
  }
  if (/forbidden/i.test(m)) {
    return '邮件程序不认识这个扩展（扩展 ID 不对）。请重新运行这个版本里的 mailer/install.sh。';
  }
  if (/exited|disconnected/i.test(m)) {
    return `邮件程序启动后意外退出（${m}）。请看日志 ~/Library/Application Support/PackHelperMailer/mailer.log；如果日志是空的，重新运行一次 mailer/install.sh。`;
  }
  if (/permission/i.test(m) && /native/i.test(m)) {
    return '扩展缺少「与本机程序通信」的权限，请在 chrome://extensions 重新加载这个扩展。';
  }
  return m;
}

/** 发一条消息给邮件程序。超时 3 分钟（大附件上传可能比较慢）。返回 {ok, ...} 或 {ok:false, error} */
export function callMailer(message, timeoutMs = 180000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: '等了 3 分钟邮件程序还没回应（可能网络很慢或 Gmail 卡住了）。请稍后点「重新发送」，或看日志 mailer.log。' });
    }, timeoutMs);
    try {
      chrome.runtime.sendNativeMessage(HOST, message, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ ok: false, error: explain(chrome.runtime.lastError.message) });
        else if (!res) resolve({ ok: false, error: '邮件程序没有返回结果。请看日志 mailer.log。' });
        else resolve(res);
      });
    } catch (e) {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: explain(e.message) });
    }
  });
}

/** 检查：邮件程序装好没有、发件邮箱的密码存了没有 */
export async function checkMailer(from) {
  const ping = await callMailer({ action: 'ping' }, 20000);
  if (!ping.ok) return ping;
  const chk = await callMailer({ action: 'check', from }, 20000);
  return chk.ok ? { ok: true, message: `邮件程序已连接（版本 ${ping.version}）。${chk.message}` } : chk;
}

/** 报告正文去掉开头给机器读的几行，以及调试信息，作为邮件正文 */
export function reportToEmailBody(text) {
  const lines = String(text).split('\n').filter((l) => !/^(STATUS|SUMMARY|ZIP|SEND_TO|SEND_FROM):/.test(l));
  const cut = lines.findIndex((l) => l.startsWith('----- 以下为调试信息'));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

export async function sendPackageMail({ from, to, bcc = [], subject, body, zipName, zipBytes, inReplyTo = '' }) {
  if (bcc.length) {
    // 旧版邮件程序会悄悄忽略密送，所以先确认版本
    const ping = await callMailer({ action: 'ping' }, 20000);
    if (!ping.ok) return ping;
    if (Number(ping.version) < 3) {
      return { ok: false, error: `Mac 上的邮件程序是旧版（版本 ${ping.version}），不支持密送。请在「终端」重新运行一次 bash ~/pack-helper/mailer/install.sh，然后点「重新发送」。` };
    }
  }
  return callMailer({
    action: 'send',
    from,
    to,
    bcc,
    inReplyTo,
    subject,
    body,
    attachment: zipBytes ? { name: zipName, base64: bytesToBase64(zipBytes) } : null,
  });
}
