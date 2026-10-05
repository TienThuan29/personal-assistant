# Personal Assistant

A desktop assistant for your tasks, notes, expenses and reminders. You talk to a chatbot (Vietnamese or English) that
reads and writes a local SQLite database, and every change it proposes waits for your confirmation first. Your data
stays on your machine; the only thing that leaves it is the chat with the LLM you configure.

## Download

No install needed: download, then run. Always the latest release:

| OS | Download | Notes |
|---|---|---|
| Windows (x64) | [Portable .exe](../../releases/latest/download/PersonalAssistant-win-x64-portable.exe) | Just run it |
| Windows (x64) | [Installer](../../releases/latest/download/PersonalAssistant-win-x64-setup.exe) | Per-user, no admin rights; use this if you want reminder pop-ups |
| macOS, Apple Silicon | [.dmg](../../releases/latest/download/PersonalAssistant-mac-arm64.dmg) | M1 and newer ([.zip](../../releases/latest/download/PersonalAssistant-mac-arm64.zip) also available) |
| macOS, Intel | [.dmg](../../releases/latest/download/PersonalAssistant-mac-x64.dmg) | ([.zip](../../releases/latest/download/PersonalAssistant-mac-x64.zip) also available) |
| Linux (x64) | [AppImage](../../releases/latest/download/PersonalAssistant-linux-x64.AppImage) | |

All versions and release notes: [Releases](../../releases).

The apps are not code-signed, so each OS warns you the first time:

- **Windows:** SmartScreen says "Windows protected your PC" → **More info** → **Run anyway**. The portable file unpacks
  itself on start, so the first launch can take 30 seconds or more.
- **macOS:** open the .dmg and drag **Personal Assistant** to Applications (or unzip the .zip and move it), then **right-click → Open → Open**.
  If macOS says the app is damaged, run `xattr -cr "/path/to/Personal Assistant.app"` once and open it again.
- **Linux:** `chmod +x PersonalAssistant-linux-x64.AppImage && ./PersonalAssistant-linux-x64.AppImage`. If it does not
  start (Ubuntu 24.04+ restricts the sandbox it needs), add `--no-sandbox`. If FUSE is missing, add
  `--appimage-extract-and-run`.

## First run

1. Open **Settings** (bottom of the sidebar) and add an LLM: Azure AI Foundry, any OpenAI-compatible gateway
   (endpoint, model, key), or a model running locally in [LM Studio](https://lmstudio.ai) (turn on its Local Server, load a
   model, pick **LM Studio**; no key needed, and your chats never leave the machine).
2. Ask "What do I have today?" or say "remind me to call Minh tomorrow at 9". Review the confirmation card, then confirm.

The interface is in Vietnamese or English (Settings → Display), and you can pick your own accent colour there too.

## Updating

The app checks GitHub once a day when it opens and shows a banner when a newer version exists; **Download** opens the
Release page. Check by hand or switch it off under Settings → Updates.

The Windows installer and the Linux AppImage can update themselves: the banner's **Update and restart** downloads the new
version, installs it and reopens the app. On macOS (the app is not signed, so it cannot replace itself) and the Windows
portable file, the banner's **Download and open installer** saves the new file to your Downloads folder: on macOS it opens
the .dmg and closes the app so you can drag **Personal Assistant** over the old one in Applications; on Windows it shows
the new .exe in its folder. Your data stays either way.

## Run in Docker (no desktop app)

For a machine where a background `PersonalAssistant.exe` is not allowed: the same assistant in a container, used from a
browser tab. Needs Docker; the image is `ghcr.io/tienthuan29/personal-assistant`.

### Pull and run the image

```bash
docker pull ghcr.io/tienthuan29/personal-assistant:latest
docker run -d --name personal-assistant --restart unless-stopped -p 127.0.0.1:9999:9999 -e TZ=Asia/Ho_Chi_Minh -v pa-data:/data ghcr.io/tienthuan29/personal-assistant:latest
docker logs personal-assistant
```

Keep each command on one line (that works in CMD, PowerShell and bash). `docker logs` prints
`http://localhost:9999/?token=…`: open it once in Chrome or Edge; the browser remembers the token.

- `-p 127.0.0.1:9999:9999` publishes the app on this machine only; `-v pa-data:/data` keeps your database and API key
  across updates. To use another host port change the first number (`-p 127.0.0.1:8080:9999`), then open that port.
- Behind a TLS-inspecting proxy (Zscaler) add
  `-v C:\path	o\zscaler-root-ca.crt:/certs/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/certs/ca.crt`.
- Stop and start: `docker stop personal-assistant`, `docker start personal-assistant`.
- Update: `docker rm -f personal-assistant`, `docker pull …:latest`, then the same `docker run` again. The `pa-data`
  volume survives `docker rm`.

### Or with Compose

```bash
cd docker
docker compose up -d          # behind a TLS-inspecting proxy (Zscaler): see below
docker compose logs assistant # prints http://localhost:9999/?token=… , open that once; the browser remembers it
```

- **Update:** `docker/update.ps1` (or `docker compose pull && docker compose up -d`). Your data stays in the `pa-data`
  volume. Updating restarts the container, so open tabs reload by themselves.
- **Corporate root CA:** copy the CA file to `docker/certs/zscaler-root-ca.crt` (it is gitignored), then add
  `-f docker-compose.yml -f docker-compose.certs.yml` to the compose commands (`update.ps1` does it when the file exists).
  Without it the LLM calls fail certificate checks on such a network. Never turn certificate checks off.
- **Port, time zone:** `PA_PORT` (default 9999) and `TZ` (default `Asia/Ho_Chi_Minh`; "today" and reminder times follow it).
- **Access:** the port is published on `127.0.0.1` only, and the token is required. `PA_TOKEN` sets your own; otherwise one
  is generated once and kept in the volume.
- **Back up:** `docker cp personal-assistant-assistant-1:/data ./pa-backup`.
- **Differences from the desktop app:** no file search, no tray, no start with Windows, no in-app install of updates.
  Reminders show as browser notifications while a tab is open (Settings → System → Enable); a reminder that comes due with
  no tab open is only marked as fired. Images are resized in the browser before upload.

## Where your data lives

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\personal-assistant` |
| macOS | `~/Library/Application Support/personal-assistant` |
| Linux | `~/.config/personal-assistant` |

It holds the database (`assistant.db`), attachments, daily backups and your encrypted key. Copy the folder to move to
another machine. The portable and installed Windows versions share it.

## Known limits

The app was designed for Windows. macOS and Linux builds are provided as they are and are less tested.

- **Reminder pop-ups on Windows** need the installer (it creates the Start-menu shortcut Windows requires). The portable
  version still lists and tracks reminders; it just cannot show the pop-up.
- **Linux:** saving an LLM key needs a system keyring (GNOME Keyring or KWallet); without one the app refuses to store it.
  Some desktops (e.g. stock GNOME) show no tray icon, so closing the window to the tray may leave no way to reopen it.
- **Linux:** the window uses Windows-style minimise/maximise/close buttons, and the "start at login"
  option does not apply.
- macOS updates are semi-automatic (see Updating). Your data is kept.

## Build from source

Needs [Bun](https://bun.sh) and Node 22.

```sh
bun install
bun run dev          # run in development
bun run test         # typecheck separately with: bun run typecheck
bun run pack:win     # or pack:mac / pack:linux; builds on the matching OS only, output in release/
```

## Publishing a release

1. Set `version` in `package.json` and commit.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** workflow builds Windows, macOS and Linux and attaches the files to a new GitHub Release.

To test the builds without publishing, run the workflow by hand from the **Actions** tab; it uploads the files as
workflow artifacts only.
