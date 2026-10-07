# Personal Assistant

Electron desktop app: a bilingual (vi/en) chatbot over a local SQLite database of tasks, notes, expenses and reminders,
plus manual CRUD pages. UI is built on `@aionui/ui` + Arco Design + UnoCSS. Every bot write waits for a confirm card.

## Commands

- `bun run dev` — electron-vite dev with watch. Dev-only single-instance takeover: a new launch replaces the old one.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run test` — vitest **on Electron's Node 22** (`ELECTRON_RUN_AS_NODE=1 electron …`), not system Node: `node:sqlite`
  there throws on binding `undefined`. Run a file with `bun run test tests/<name>.test.ts`.
- `tests/eval.llm.test.ts` (real-LLM eval) and `tests/seed-demo.test.ts` are opt-in via env vars (`LLM_*`, `PA_SEED_DB`).
  Re-run the eval after any prompt or tool-description edit.
- `bun run pack` — local Windows NSIS build. `pack:win|mac|linux` are for CI.

## Layout

- `src/main/` — main process. `ipc.ts` (handlers), `agent.ts` (tool loop), `llm.ts` + `gateway.ts` (providers),
  `prompt.ts`, `db.ts`/`migrations.ts`/`store.ts`, `save.ts` (manual CRUD), `reminders.ts`, `update.ts`/`selfupdate.ts`,
  `tools/` (one file per domain; `index.ts` is the registry).
- `src/renderer/` — React UI: `chat/` (cards, send box), `pages/` (Today, Tasks, Notes, Expenses, Reminders, Settings),
  `accent.ts` (custom colour tokens).
- `src/shared/` — types, dates, money, `patch.ts`, i18n + `locales/{vi,en}.ts`.
- `docs/` — `design.md` (D1–D17) and a `*-design.md` / `*-plan.md` pair per feature, each with an "As built" section.
  `plan.md` has Known gaps; `smoke-test.md` is the manual checklist. Read the relevant design doc before changing a feature.

## Conventions and gotchas

- `@aionui/ui` is a packed tarball (`vendor/aionui-ui-0.1.0.tgz`); bun's directory dep fails with EPERM. Repack to update it.
- Bot writes go through the write tools and parked `pending_actions` (confirm/ask cards). Manual forms reuse the same tools
  via IPC `data:save` and send only changed fields (`diffPatch`). Don't change the bot tools for UI work.
- File tools (`find_files`/`grep_files`/`read_file`, tool kind `fs`) are kept out of `TOOLS` so `data:read` can't reach them,
  and are offered only when the user message has `files: true`. No regex grep (ReDoS on main).
- LLM calls use Electron `net.fetch` because of corporate TLS inspection. Never disable TLS verification.
- The gateway provider ignores OpenAI `tools` and rejects array content, so it uses the prompt-based `tool_calls` adapter
  in `gateway.ts`. It needs examples, not rules, in the prompt. Its endpoint is host-only; the app adds `/v1`.
- Prompt and tool descriptions are English; UI strings go through i18next (`vi`/`en`), errors through `errors:` keys
  (`src/main/errors.ts`). Dates display as dd/mm/yyyy.
- Accent text on `accent-soft` over sunken fails AA — use ink text with an accent icon.
- Releases: tag `vX.Y.Z` must equal `package.json` `version` (CI `check`). Update notice is notify-only except Windows NSIS
  and Linux AppImage (self-update).
- Never print or log the LLM token (`secrets.bin`, safeStorage).

## Running and verifying the UI

- Never `taskkill /IM electron.exe` — it kills the user's running app. Kill only your own PID: `taskkill /PID <id> /T /F`.
- Headless screenshot (needs a scratch profile and both flags or the page is blank):
  `PA_SCREENSHOT_DELAY=5000 PA_SCREENSHOT=<png> PA_PAGE=today|tasks|notes|expenses|reminders|settings PA_THEME=light|dark env -u ELECTRON_RUN_AS_NODE timeout 90 npx electron-vite dev -- --user-data-dir=<scratch> --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`
- Add `--remote-debugging-port=9333` after `--` to drive the page over CDP.
- The user's real DB is nearly empty; seed a scratch profile with `tests/seed-demo.test.ts`.
- Dev and packaged builds share userData (`%APPDATA%/personal-assistant`).
