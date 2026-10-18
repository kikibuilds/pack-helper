# Pack Helper (Chrome extension)

[中文说明](README.md)

Pack Helper is for small resellers on **Poshmark, Mercari, Depop and Whatnot** who want someone else to do the picking and packing — without giving that person access to any selling account.

It pulls every "to ship" order and its prepaid shipping label from the seller dashboards you are already signed into, lets you check everything in one table, and builds one shipping file per batch. An optional macOS mail helper emails the file to whoever packs, and can run the whole flow remotely when you email it a command.

The interface switches between Chinese and English with the **English / 中文** button at the top right of the page (the choice is remembered). The shipping file itself (packing list, instructions, email text) is generated in Chinese.

```
发货_2026-10-14_183508.zip              (发货 = "shipping")
├── 打包清单.html          packing list: one row group per package with photo, SKU, qty,
│                          clickable order #, "open label" link; tick "picked / out of stock"
│                          and "packed / problem", add notes, then generate a result table
├── 打包清单.csv           same content for Google Sheets / Excel
├── 打印-面单带对照卡.pdf   print this: before each label, a same-size text card
│                          (big package code + SKU + qty + item name)
├── 打印-packing slip（缺面单）.pdf   only when some packages have no label yet: one card
│                          per such package in the same format, so the packer can pick and bag first
├── 使用说明.txt           step-by-step instructions for the packer
└── 面单/                  one label file per package (P01_Poshmark_….pdf, M01_…, D01_…)
```

Package codes: **P** = Poshmark, **M** = Mercari, **D** = Depop, **W** = Whatnot, **X** = other. One code = one package = one label; several items in one order share a code. The packing list contains no buyer names or addresses.

## Install (about a minute)

1. Unzip `pack-helper-V<version>.zip`. You get a `pack-helper` folder — put it in your home folder (`/Users/<you>/pack-helper`), not in Downloads.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `pack-helper` folder.
4. Pin the extension. Clicking its icon opens the Pack Helper home page (or switches to it if it's already open).


## Layout (from V0.7)

The toolbar icon opens the **home page**: "Needs attention" at the top (a platform needs sign-in, labels missing, heartbeat failing… — click to jump there), feature cards below.

```
Home
├─ 🚚 Shipping         ① Pull orders · ② Batch & pack · ⚙ Shipping settings
├─ 📨 Remote commands  on/off, allowed senders, passphrase, who receives the pack
├─ 🩺 Monitoring       offline alerts & sign-in check · remote command log · diagnostics
└─ ⚙ Settings (top right)  email account · email template · features · about
```

**Features** (⚙ Settings → Features) turns features on or off; a feature that is off disappears from the home page and its scheduled jobs stop, settings are kept. Every feature is a self-contained module — see [docs/MODULES.md](docs/MODULES.md) to add your own.

## Update (settings are kept)

1. Unzip the new version, drag the `pack-helper` folder into your home folder and choose **Replace**.
2. Click ↻ on the extension in `chrome://extensions`.

Settings, recipients, the batch table and packed history live in Chrome and survive updates. Never click **Remove** on the extension — that erases them. Re-run `mailer/install.sh` only when the [changelog](CHANGELOG.md) says so. The version number is shown next to the page title and stamped into every packing list.

## Pull orders

On the home page open **🚚 Shipping → ① Pull orders** and click **▶ Pull orders** (the drop-down next to it limits the pull to one platform). The extension:

1. opens each platform's to-ship list (on Depop it clicks "To ship" first; on Whatnot it opens Seller Hub → Shipments filtered to "All Shows & Marketplace" + "Unfulfilled", so both show and marketplace sales are included, and skips anything already shipped);
2. reads each order — item name, photo, SKU, quantity, order number (Mercari also reads the item page for the full title; a SKU in square brackets at the end of a title is picked up automatically);
3. downloads the prepaid label (it never clicks Buy / Purchase / Pay / Upgrade / QR — it only downloads labels that are already paid for);
4. lists everything in the table. Nothing is packed automatically.

Keep the Pack Helper page open while it runs (you can switch to other pages; the top bar shows progress). A clean pull switches to **② Batch & pack** by itself; if there were problems it stays on the pull tab so you see "This pull" first. Check the table — edit names, SKUs, quantities, drag in missing labels — then tick what to ship and click **⬇ Pack & download** or **✉ Pack & email**.

- **No duplicates:** packed orders are remembered for 45 days. If a platform still lists one as to-ship, it is marked "Packed before" and left unticked. Click the × on the mark to clear it.
- **Missing labels** show the reason and a link to the order page. Packages without a label stay in the batch and are flagged red on the packing list. The zip also has "打印-packing slip（缺面单）.pdf": one card per package without a label, in the same format as the lookup card (code, order #, SKU × qty, item name; for Whatnot each item also shows its own Order #). The packer can pick and bag first and write the code on the bag; once you add the label and pull again, it goes into the next zip.
- **Shipped orders** (e.g. Mercari "Awaiting rating from buyer") are skipped.
- **Whatnot:** every item is its own order (Order #); items from the same buyer are bundled into one Shipment = one package, code W. Generate the label in Whatnot yourself (check weight and size); the extension only downloads labels that already exist ("Ready to Ship", button "Print Shipping Label"). That PDF starts with Whatnot's packing slip and ends with the label — the extension splits it so only the label page is printed. Shipments still showing "Needs Label" are flagged as missing a label; the extension **never clicks "Generate Label"**, "Generate New Label" or "Mark Package as Shipped". The SKU comes from square brackets in the title, otherwise from the "SKU" line on the packing slip (taken from the label PDF, or via "Generate Packing Slip" when there is no label yet), matched to each item by order number. Whatnot's own packing slip is only read for SKUs and never put in the zip (it shows prices and addresses).

## Add an order by hand

Below the table, **＋ Add an order by hand** adds offline sales or anything the pull can't see: choose a new package or add to an existing one (same box, same label), pick the platform, and fill in photo, item name, SKU, quantity, order number and label. Hand-added rows are kept when you pull again.

## Email (Mac + Gmail)

**✉ Pack & email** packs the batch and sends the zip through the mail helper on your Mac. The page shows ① packing → ② sending → ③ sent / failed (with the reason), and failed sends can be resent without repacking.

Set up once:

1. Turn on 2-Step Verification for the Gmail account, then create an app password at <https://myaccount.google.com/apppasswords>.
2. In Terminal, run `bash ~/pack-helper/mailer/install.sh`, enter the Gmail address and paste the app password. It is stored only in the macOS Keychain.
3. Quit Chrome completely (⌘Q) and reopen it, then click **Test mail connection** under ⚙ Settings → Email account.

Under ⚙ Settings → Email account you set the sender, up to 5 recipients and an optional BCC (recipients can't see it); ⚙ Settings → Email subject and body holds the template (placeholders `{日期}` date, `{包裹数}` packages, `{件数}` items, `{附件}` attachment name, `{缺面单提醒}` missing-label warning, `{包裹清单}` package list), with a live preview.

## Remote commands (by email)

Away from the computer? Email the sender Gmail from your phone and this computer pulls, packs, emails the pack and replies with the result.

On the home page open **📨 Remote commands**: tick **Enable remote commands** (it checks that sender, allowed senders, passphrase and "send pack to" are all filled in, then saves), list the **allowed senders**, set a **passphrase** (or click Generate), the check interval and who receives the pack.

Put the passphrase and a command word in the email **subject**:

| Subject | What happens |
|---|---|
| `PASSPHRASE pack` | Re-pull every platform, pack every order that has a label, email it, reply with the result |
| `PASSPHRASE pull` | Preview only: pull and reply with what would be packed, missing labels, sign-in problems |
| `PASSPHRASE status` | Reply with computer, extension, mail helper, sign-in and last-run status |
| `PASSPHRASE resend` | Resend the last pack whose email failed |

Chinese command words (打包 / 拉取 / 状态 / 重发) work too. Every command gets a "received" reply first and a result reply when done. Only allowed senders whose mail passes Gmail's DKIM/DMARC check are obeyed; commands older than 3 hours are ignored; each email runs once; the helper's own replies never trigger commands.

The computer must stay on and awake, Chrome open, and all three platforms signed in. For working from abroad, pair this with a remote-desktop app so you can sign back in when a session expires.

## The packing list (for the packer)

Open `打包清单.html` from the **unzipped** folder in Chrome. For each package, tick **picked** or **out of stock** for every item and **packed** or **problem** for the package, and add notes. Ticks and notes are saved in that browser. **Generate result** refuses to run until everything is ticked (missing ticks are outlined in yellow), then builds a table — problems first, packed packages folded into one line — that can be copied into an email or printed / saved as PDF with clickable order links.

## Offline alerts, daily sign-in check and diagnostics

Home page → **🩺 Monitoring**: "Offline alerts & sign-in check", "Remote command log" and "Diagnostics" (a status overview; "Open the full diagnostics page" exports or copies the report).

**Offline alerts (heartbeat)**: when the computer sleeps, loses power or goes offline, the extension cannot send anything itself, so an external monitoring service does the alerting. The extension visits the service's "heartbeat URL" every few minutes; if no ping arrives in time, the service emails or pushes an alert to you.
1. Sign up for a free monitoring service such as [healthchecks.io](https://healthchecks.io) (Better Stack, Cronitor and similar work too), create a check with a 5-minute period and a 10–30-minute grace time, and choose email or the phone app for notifications.
2. Paste the URL it gives you (e.g. `https://hc-ping.com/…`) into "Heartbeat URL", tick "Enable offline alerts", click "Ping now" and confirm the service received it.
3. The grace time prevents false alarms from a brief slow connection: you are alerted only after period + grace with no ping.

**Daily sign-in check**: once a day the extension opens the Poshmark, Mercari, Depop and Whatnot to-ship lists in the background; if one lands on a sign-in page it emails "Alert email to" from the sender under "Email" (leave it empty to only record the result on the diagnostics page). It only looks — no clicks, no batch changes — and waits 15 minutes if a pull or remote command is running. "Check sign-in now" runs it immediately. The computer must be on and the mail helper installed.

**Diagnostics page**: extension version, mail helper, each platform's sign-in status (from the daily check or the last pull, whichever is newer), heartbeat, remote commands, errors and label failures from the last pull, and orders still missing a label. When something goes wrong, click "⬇ Export diagnostics" or "Copy diagnostics" and send it to the developer: email addresses are masked; the passphrase, heartbeat URL key and buyer names/addresses are never included.

The remote `status` reply also includes the last heartbeat and the last sign-in check.

## Running unattended: power loss and expired sign-ins

Everything depends on Chrome staying open on this computer with all three platforms signed in. If you'll be away (even abroad), prepare like this:

**Before you leave (these can't be done remotely)**
- System Settings → Energy: turn off automatic sleep and turn on "Start up automatically after a power failure"; enable automatic login for the user.
- Make Chrome and your remote-desktop app open at login (System Settings → General → Login Items).
- Install remote desktop: e.g. ToDesk or Sunlogin (works across regions) as the main tool, Tailscale + macOS Screen Sharing as a backup. Granting Screen Recording / Accessibility permissions the first time must be done at the machine.
- Turn off automatic major macOS upgrades (they can reset those permissions). A wired connection and a small UPS help.
- Make sure you can still receive the platforms' SMS verification codes while away.

**Spotting and fixing problems**

| Problem | How you find out | Fix |
|---|---|---|
| A platform sign-in expired | The daily sign-in check emails you; remote replies and the `status` reply also say "X needs you to sign in again" | Connect by remote desktop, sign in again in Chrome, resend the command |
| Network hiccup | The reply / page shows why sending failed | It retries automatically; otherwise send `PASSPHRASE resend` |
| Computer asleep, power loss, Chrome closed | With offline alerts on, the monitoring service emails / pushes you; otherwise no "received" reply after a command | Wake it or open Chrome by remote desktop; after a power cut it restarts by itself; if all else fails, ask someone on site to press the power button |
| A platform redesign breaks reading | Replies / "This pull" / the diagnostics page show failures | Export diagnostics from the diagnostics page and send it to the developer (contact below) |

## Planned features

- **Scheduled runs**: e.g. pull and pack automatically every Monday and Thursday morning.

## Notes

- **Unofficial.** Not affiliated with Poshmark, Mercari, Depop or Whatnot. It only opens your own seller pages in your own signed-in Chrome, at roughly human pace. Platform terms on automation differ — use your own judgment and don't run it at high frequency.
- **Pages change.** Reading rules match the pages as of October 2026. If a platform redesign breaks something, "This pull → Detailed diagnostics" under Shipping → ① Pull orders shows the page structure; list URLs and link patterns are editable under ⚙ Shipping settings.
- **Local only.** Orders, images and labels stay in this Chrome (chrome.storage + IndexedDB); the Gmail app password stays in the Keychain; nothing is uploaded anywhere.
- **Fixed extension ID.** The `key` in `manifest.json` pins the ID to `ohpffalnkclojleccgidgjnlggnpjfab`, which the mail helper trusts. If you fork it, remove `key` and set `EXT_ID` in `mailer/install.sh` to your own ID.
- The mail helper currently supports **macOS + Gmail** only.

## License

MIT — see [LICENSE](LICENSE). Bundled [pdf-lib](https://github.com/Hopding/pdf-lib) is MIT too (`lib/pdf-lib.LICENSE.md`).

## Contact and feedback

If you run into any problem, feel free to get in touch or send feedback at:
[kiki.redbook@gmail.com](mailto:kiki.redbook@gmail.com)
