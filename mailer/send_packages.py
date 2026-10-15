#!/usr/bin/env python3
"""发货邮件程序（macOS）。

扩展里点「✉ 打包并发邮件」时，Chrome 通过 Native Messaging 直接调用本程序：
扩展把 zip 和邮件内容交过来，本程序用 Gmail 发出，并把结果（成功 / 失败原因）当场返回给扩展。
远程指令：扩展定时让本程序用 IMAP 查一下 Gmail 收件箱，找出白名单邮箱发来、标题里带暗号的指令邮件。

用法：
  python3 send_packages.py native      # 由 Chrome 调用（install.sh 会注册），不要手动运行
  python3 send_packages.py test        # 发一封测试邮件（安装时用）
  python3 send_packages.py check EMAIL # 检查某个发件邮箱有没有保存密码

只用 Python 标准库。Gmail 应用专用密码存放在 macOS 钥匙串（服务名 PackHelperMailer，账户 = 发件邮箱）。
测试用：环境变量 PACKHELPER_SMTP_PASSWORD 可代替钥匙串；PACKHELPER_FAKE_SMTP=目录 时不真正发信，把邮件存成 .eml；
PACKHELPER_FAKE_IMAP=目录 时把目录里的 .eml 当成收件箱。
"""
import base64
import datetime
import email
import email.policy
import email.utils
import imaplib
import json
import os
import re
import smtplib
import socket
import ssl
import time
import struct
import subprocess
import sys
import traceback
from email.message import EmailMessage
from pathlib import Path

VERSION = "6"  # 3：密送；4：连接重试；5：远程指令；6：发指令的邮箱可以就是发件邮箱自己
APP_DIR = Path(os.environ.get("PACKHELPER_APP_DIR") or (Path.home() / "Library" / "Application Support" / "PackHelperMailer"))
KEYCHAIN_SERVICE = "PackHelperMailer"
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$")
MAX_ATTACH_MB = 24  # Gmail 附件上限 25MB（编码后会变大一些）


def log(msg):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    try:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        with open(APP_DIR / "mailer.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_config():
    try:
        return json.loads((APP_DIR / "config.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {}


class MailError(Exception):
    """给用户看的错误（中文说明 + 怎么处理）。"""


def get_password(sender):
    env = os.environ.get("PACKHELPER_SMTP_PASSWORD")
    if env:
        return env
    try:
        r = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", sender, "-w"],
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise MailError(f"读取钥匙串失败：{e}")
    if r.returncode != 0:
        raise MailError(f"Mac 钥匙串里没有发件邮箱 {sender} 的 Gmail 应用专用密码。"
                        f"请在终端运行 mailer/install.sh，发件邮箱填 {sender}，再粘贴它的应用专用密码。")
    return r.stdout.strip()


def smtp_send(msg, sender):
    fake = os.environ.get("PACKHELPER_FAKE_SMTP")
    password = get_password(sender)
    if fake:  # 测试用
        Path(fake).mkdir(parents=True, exist_ok=True)
        name = f"{datetime.datetime.now():%Y%m%d_%H%M%S_%f}.eml"
        (Path(fake) / name).write_bytes(msg.as_bytes())
        return
    # 先连上并登录（这一步失败不会发出任何邮件，可以放心重试，也会换 587 端口试）；
    # 真正发信只发一次，避免网络抖动时同一封邮件发两遍。
    attempts = [("ssl", 465), ("starttls", 587), ("ssl", 465), ("starttls", 587)]
    errors = []
    s = None
    for i, (mode, port) in enumerate(attempts):
        try:
            ctx = ssl.create_default_context()
            if mode == "ssl":
                s = smtplib.SMTP_SSL("smtp.gmail.com", port, context=ctx, timeout=30)
            else:
                s = smtplib.SMTP("smtp.gmail.com", port, timeout=30)
                s.ehlo()
                s.starttls(context=ctx)
                s.ehlo()
            s.login(sender, password)
            break
        except smtplib.SMTPAuthenticationError as e:
            raise MailError(f"Gmail 拒绝登录 {sender}：应用专用密码不对或已经失效（{e.smtp_code}）。"
                            f"请到 https://myaccount.google.com/apppasswords 重新生成，再运行一次 install.sh。")
        except (smtplib.SMTPException, socket.gaierror, socket.timeout, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
            errors.append(f"{port} 端口：{e}")
            log(f"连接 Gmail 第 {i + 1} 次失败（{port} 端口）：{e}")
            try:
                if s:
                    s.close()
            except Exception:
                pass
            s = None
            if i < len(attempts) - 1:
                time.sleep(3)
    if s is None:
        raise MailError("连不上 Gmail 服务器，试了 4 次（465 和 587 端口）都失败，邮件没有发出。"
                        "请检查网络（关掉 VPN / 代理试试），然后点「重新发送」。\n" + "\n".join(errors))
    try:
        s.send_message(msg)
    except smtplib.SMTPRecipientsRefused as e:
        raise MailError(f"收件人被 Gmail 拒绝：{', '.join(e.recipients)}")
    except smtplib.SMTPDataError as e:
        raise MailError(f"Gmail 拒收这封邮件（{e.smtp_code}）：{e.smtp_error.decode(errors='replace')[:200]}")
    except (smtplib.SMTPException, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
        raise MailError(f"已经连上 Gmail，但上传邮件时网络断了：{e}。"
                        f"邮件可能没发出，也可能已经发出——请先看一下发件邮箱的「已发送」或密送邮箱，没有再点「重新发送」。")
    finally:
        try:
            s.quit()
        except Exception:
            pass


def build_message(sender, to, subject, body, attachment=None, bcc=None, in_reply_to=None):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    # 标记「这是发货助手自己发的」：查收件箱时跳过，避免发件邮箱给自己回信后又被当成新指令（死循环）
    msg["X-PackHelper"] = "1"
    msg["Auto-Submitted"] = "auto-generated"
    if in_reply_to:  # 回复指令邮件时接在同一个对话里
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    if bcc:  # 发送时 smtplib 会把 Bcc 头去掉，收件人看不到密送了谁
        msg["Bcc"] = ", ".join(bcc)
    msg.set_content(body + "\n")
    if attachment:
        msg.add_attachment(attachment["bytes"], maintype="application", subtype="zip", filename=attachment["name"])
    return msg


# —— 远程指令：查收件箱 ——
STATE_FILE = "remote_state.json"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def load_state():
    try:
        return json.loads((APP_DIR / STATE_FILE).read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    (APP_DIR / STATE_FILE).write_text(json.dumps(state, ensure_ascii=False), "utf-8")


class GmailInbox:
    """用 IMAP 读 Gmail 收件箱（只读邮件头，不下载正文）。"""

    def __init__(self, account, password):
        self.account, self.password, self.c = account, password, None

    def __enter__(self):
        errors = []
        for i in range(3):
            try:
                self.c = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=ssl.create_default_context(), timeout=30)
                self.c.login(self.account, self.password)
                self.c.select("INBOX")
                return self
            except imaplib.IMAP4.error as e:
                raise MailError(f"Gmail 拒绝读取收件箱（{e}）。请确认应用专用密码没有失效；"
                                f"如果刚改过密码，重新运行一次 install.sh。")
            except (socket.timeout, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
                errors.append(str(e))
                time.sleep(2)
        raise MailError("连不上 Gmail 收件箱（imap.gmail.com:993），请检查网络：" + "；".join(errors))

    def __exit__(self, *exc):
        try:
            self.c.logout()
        except Exception:
            pass

    def candidates(self, senders, since):
        day = f"{since.day:02d}-{MONTHS[since.month - 1]}-{since.year}"
        seen = set()
        for a in senders:
            typ, data = self.c.uid("SEARCH", None, "SINCE", day, "FROM", f'"{a}"')
            if typ != "OK" or not data or not data[0]:
                continue
            for uid in data[0].split():
                if uid in seen:
                    continue
                seen.add(uid)
                typ, d = self.c.uid("FETCH", uid, "(BODY.PEEK[HEADER])")
                raw = next((x[1] for x in d or [] if isinstance(x, tuple)), None)
                if raw:
                    yield uid, raw

    def mark_seen(self, uid):
        try:
            self.c.uid("STORE", uid, "+FLAGS", "(\\Seen)")
        except Exception:
            pass


class FakeInbox:
    """测试用：目录里的 .eml 文件当作收件箱。"""

    def __init__(self, folder):
        self.folder = Path(folder)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def candidates(self, senders, since):
        for f in sorted(self.folder.glob("*.eml")):
            yield f.name, f.read_bytes()

    def mark_seen(self, uid):
        pass


def sender_verified(msg, addr, account=""):
    """Gmail 收信时会在最上面加一行 Authentication-Results；DMARC 通过、或 DKIM 签名域和发件人一致，才认为不是冒充的。
    只看最上面那一行（Gmail 自己加的），下面的可能是发信人伪造的。"""
    domain = addr.rsplit("@", 1)[-1].lower()
    headers = msg.get_all("Authentication-Results") or []
    if not headers:
        # 用发件邮箱自己给自己发：Gmail 内部投递，没有验证结果。外面寄进来的邮件一定会被 Gmail 加上验证结果，所以这种情况只可能是自己发的
        if account and addr == account.lower():
            return True, ""
        return False, "邮件缺少 Gmail 的发件人验证结果"
    results = str(headers[0]).lower()
    if "mx.google.com" not in results:
        return False, "邮件缺少 Gmail 的发件人验证结果"
    if re.search(r"\bdmarc=pass\b", results):
        return True, ""
    for d in re.findall(r"dkim=pass[^;]*?header\.[id]=@?([a-z0-9.-]+)", results):
        if d == domain or d.endswith("." + domain) or domain.endswith("." + d):
            return True, ""
    return False, "发件人验证没通过（DKIM/DMARC），可能是冒充你邮箱的邮件，已忽略"


def parse_action(subject, secret):
    rest = re.sub(re.escape(secret), " ", subject, flags=re.I)
    if re.search(r"状态|status", rest, re.I):
        return "status"
    if re.search(r"重发|resend", rest, re.I):
        return "resend"
    if re.search(r"拉取|pull|check", rest, re.I) and not re.search(r"打包|pack|发", rest, re.I):
        return "pull"
    return "pack"


def poll_commands(req):
    account = str(req.get("from", "")).strip()
    allow = sorted({a.strip().lower() for a in req.get("allow", []) if isinstance(a, str) and EMAIL_RE.match(a.strip())})
    secret = str(req.get("secret", "")).strip()
    max_age = int(req.get("maxAgeMinutes") or 180)
    if not EMAIL_RE.match(account):
        raise MailError(f"发件邮箱格式不对：{account or '（空）'}")
    if not allow:
        raise MailError("还没有设置「允许发指令的邮箱」。")
    if len(secret) < 4:
        raise MailError("暗号太短（至少 4 个字），请在设置里改一下。")
    now = datetime.datetime.now(datetime.timezone.utc)
    state = load_state()
    processed = list(state.get("processed", []))
    done = set(processed)
    commands, rejected = [], []
    fake = os.environ.get("PACKHELPER_FAKE_IMAP")
    inbox = FakeInbox(fake) if fake else GmailInbox(account, get_password(account))
    with inbox as box:
        for uid, raw in box.candidates(allow, now - datetime.timedelta(days=1)):
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            mid = str(msg.get("Message-ID") or "").strip() or f"uid-{uid.decode() if isinstance(uid, bytes) else uid}"
            if mid in done:
                continue
            addr = email.utils.parseaddr(str(msg.get("From") or ""))[1].lower()
            if msg.get("X-PackHelper"):
                continue  # 发货助手自己发的回信 / 发货邮件
            subject = str(msg.get("Subject") or "")
            if addr not in allow or secret.lower() not in subject.lower():
                continue  # 普通邮件：不碰
            done.add(mid)
            processed.append(mid)
            box.mark_seen(uid)
            ok, why = sender_verified(msg, addr, account)
            if not ok:
                rejected.append({"from": addr, "subject": subject, "reason": why})
                continue
            try:
                sent_at = email.utils.parsedate_to_datetime(str(msg.get("Date")))
                if sent_at.tzinfo is None:
                    sent_at = sent_at.replace(tzinfo=datetime.timezone.utc)
                age = (now - sent_at).total_seconds() / 60
            except (TypeError, ValueError):
                sent_at, age = None, 0
            item = {"id": mid, "from": addr, "subject": subject, "messageId": mid,
                    "action": parse_action(subject, secret), "sentAt": sent_at.isoformat() if sent_at else ""}
            if age > max_age:
                item["expired"] = True
                item["reason"] = f"这封指令是 {int(age // 60)} 小时 {int(age % 60)} 分钟前发的，超过 {max_age // 60} 小时，没有执行"
            commands.append(item)
    state["processed"] = processed[-500:]
    state["lastPoll"] = now.isoformat(timespec="seconds")
    save_state(state)
    for c in commands:
        log(f"收到远程指令：{c['from']}｜{c['subject']}｜{c['action']}{'（已过期）' if c.get('expired') else ''}")
    for r in rejected:
        log(f"忽略指令：{r['from']}｜{r['subject']}｜{r['reason']}")
    return {"ok": True, "commands": commands, "rejected": rejected}


# —— Native Messaging（Chrome ↔ 本程序）：4 字节长度 + JSON ——
def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    data = sys.stdin.buffer.read(n)
    return json.loads(data.decode("utf-8"))


def write_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def handle(req):
    action = req.get("action")
    if action == "ping":
        cfg = load_config()
        return {"ok": True, "version": VERSION, "senders": cfg.get("senders", [])}

    if action == "check":
        sender = str(req.get("from", "")).strip()
        if not EMAIL_RE.match(sender):
            raise MailError(f"发件邮箱格式不对：{sender or '（空）'}")
        get_password(sender)
        return {"ok": True, "version": VERSION, "message": f"发件邮箱 {sender} 已保存密码，可以发信。"}

    if action == "send":
        sender = str(req.get("from", "")).strip()
        to = [a.strip() for a in req.get("to", []) if isinstance(a, str) and EMAIL_RE.match(a.strip())][:5]
        if not EMAIL_RE.match(sender):
            raise MailError(f"发件邮箱格式不对：{sender or '（空）'}，请在扩展「设置 → 邮件」里填写。")
        if not to:
            raise MailError("没有有效的收件人，请在扩展「设置 → 邮件」里添加。")
        bad_bcc = [a for a in req.get("bcc", []) or [] if not (isinstance(a, str) and EMAIL_RE.match(a.strip()))]
        if bad_bcc:
            raise MailError(f"密送邮箱格式不对：{', '.join(map(str, bad_bcc))}")
        bcc = [a.strip() for a in req.get("bcc", []) or [] if a.strip().lower() not in {t.lower() for t in to}][:5]
        att = req.get("attachment")
        attachment = None
        if att:
            raw = base64.b64decode(att.get("base64", ""))
            size_mb = len(raw) / 1024 / 1024
            if size_mb > MAX_ATTACH_MB:
                raise MailError(f"发货文件有 {size_mb:.1f} MB，超过 Gmail 附件上限（25MB），没法用邮件发送。"
                                f"请直接把电脑上的发货文件拷给员工。")
            attachment = {"name": str(att.get("name") or "发货.zip"), "bytes": raw}
        reply_to = str(req.get("inReplyTo") or "").strip() or None
        msg = build_message(sender, to, str(req.get("subject") or "[发货]"), str(req.get("body") or ""), attachment, bcc, reply_to)
        smtp_send(msg, sender)
        cc_txt = f"（密送 {', '.join(bcc)}）" if bcc else ""
        log(f"已发送：{sender} → {', '.join(to)}{cc_txt}｜{req.get('subject', '')}")
        return {"ok": True, "message": f"已从 {sender} 发给 {', '.join(to)}{cc_txt}", "bcc": bcc,
                "sentAt": datetime.datetime.now().isoformat(timespec="seconds")}

    if action == "poll":
        return poll_commands(req)

    raise MailError(f"未知操作：{action}")


def native_main():
    req = None
    try:
        req = read_message()
        if req is None:
            return 0
        res = handle(req)
    except MailError as e:
        log(f"失败（{(req or {}).get('action', '?')}）：{e}")
        res = {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 — 任何意外都要把原因带回扩展
        log(f"意外错误：{traceback.format_exc()}")
        res = {"ok": False, "error": f"邮件程序出错：{type(e).__name__}: {e}"}
    write_message(res)
    return 0


def test_main():
    cfg = load_config()
    sender, to = cfg.get("sender"), cfg.get("recipients") or []
    if not sender or not to:
        print("配置里没有发件邮箱或测试收件人，请重新运行 install.sh。")
        return 2
    msg = build_message(sender, to, "[发货] 测试邮件 · 邮件程序已配置好",
                        "这是发货助手的测试邮件。\n\n以后在扩展批次页点「✉ 打包并发邮件」，扩展会直接调用这个邮件程序发出发货文件，"
                        "并在页面上显示发送成功或失败。")
    try:
        smtp_send(msg, sender)
    except MailError as e:
        print(f"测试邮件发送失败：{e}")
        return 1
    print(f"测试邮件已从 {sender} 发到 {', '.join(to)}，请检查收件箱（也看一下垃圾邮件）。")
    return 0


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "native" or cmd.startswith("chrome-extension://"):
        return native_main()
    if cmd == "test":
        return test_main()
    if cmd == "check" and len(argv) > 2:
        try:
            get_password(argv[2])
            print(f"OK：{argv[2]} 已保存密码")
            return 0
        except MailError as e:
            print(e)
            return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
