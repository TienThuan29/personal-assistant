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
| macOS, Apple Silicon | [.zip](../../releases/latest/download/PersonalAssistant-mac-arm64.zip) | M1 and newer |
| macOS, Intel | [.zip](../../releases/latest/download/PersonalAssistant-mac-x64.zip) | |
| Linux (x64) | [AppImage](../../releases/latest/download/PersonalAssistant-linux-x64.AppImage) | |

All versions and release notes: [Releases](../../releases).

The apps are not code-signed, so each OS warns you the first time:

- **Windows:** SmartScreen says "Windows protected your PC" → **More info** → **Run anyway**. The portable file unpacks
  itself on start, so the first launch can take 30 seconds or more.
- **macOS:** unzip, move **Personal Assistant** to Applications (or anywhere), then **right-click → Open → Open**.
  If macOS says the app is damaged, run `xattr -cr "/path/to/Personal Assistant.app"` once and open it again.
- **Linux:** `chmod +x PersonalAssistant-linux-x64.AppImage && ./PersonalAssistant-linux-x64.AppImage`. If it does not
  start (Ubuntu 24.04+ restricts the sandbox it needs), add `--no-sandbox`. If FUSE is missing, add
  `--appimage-extract-and-run`.

## First run

1. Open **Settings** (bottom of the sidebar) and add an LLM: either Azure AI Foundry or any OpenAI-compatible gateway
   (endpoint, model, key).
2. Ask "What do I have today?" or say "remind me to call Minh tomorrow at 9". Review the confirmation card, then confirm.

The interface is in Vietnamese or English (Settings → Display), and you can pick your own accent colour there too.

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
- **macOS and Linux:** the window uses Windows-style minimise/maximise/close buttons, and the "start with Windows"
  option does not apply.
- No automatic updates: download a new release to upgrade. Your data is kept.

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
