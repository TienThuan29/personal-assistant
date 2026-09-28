# Bilingual vi/en: Implementation Plan

**Goal:** a runtime-switchable UI language (vi/en), a money display style and a default currency, as specified in [i18n-design.md](i18n-design.md).

**Conventions:** as in [plan.md](plan.md), lines 15–38.
- bun, with tests run on Electron's Node (`bun run test`).
- Bind `?? null`, never `undefined`.
- Conventional Commits, each with the `Co-Authored-By` trailer.
- The dev screenshot hook (`PA_SCREENSHOT`, `PA_PAGE`) is available for UI checks.

The existing code is the reference. These tasks give precise specs rather than full code. Each task ends with `bun run typecheck && bun run test` passing and one commit, and updates this plan if it deviates.

---

## Task I1: i18n core and translated errors (main)

1. `bun add -d i18next react-i18next` (use `--ignore-scripts`; add them as devDependencies so electron-vite bundles them).
2. Resources:
   - Create `src/shared/locales/vi.ts` and `en.ts`. Export `const vi = { common: {}, chat: {}, pages: {}, settings: {}, errors: {}, system: {} } as const`, and type `en` as `Resources` (a structural type of `vi` with `string` values).
   - Create `src/shared/i18n.ts`:
     - `export type Lang = 'vi' | 'en'`
     - `resources`
     - `createI18n(lang)`, which returns an initialized `i18next.createInstance()` (initImmediate false, fallbackLng 'vi', interpolation escapeValue false)
     - the `CustomTypeOptions` declaration
3. Main instance: `src/main/i18n.ts` exports `i18n` (created with 'vi') and `setLanguage(lang)`.
4. Errors:
   - Add `class UserError extends Error { constructor(public key: string, public params?: Record<string, unknown>) }` to `tools/common.ts`.
   - `errMsg(e)` translates a `UserError`, or a plain `Error` whose message is a known `errors:` key, using the main instance.
   - Replace every hard-coded Vietnamese error in `src/main/**` with keys in the `errors` namespace:
     - tools, `common.ts` `requireRows`, `sql.ts`, `settings.ts` zod messages, and `ipc.ts` validation;
     - `describeLlmError` (keep the logic, translate the text);
     - `llm.ts` "not configured" and "truncated";
     - `agent.ts` MAX_ROUNDS, empty-reply and "interrupted" texts;
     - `attachments`/`toJpeg`.
   - zod messages become keys, e.g. `'errors:dateFormat'`. `parseArgs` translates each issue message with `t` when it is a key. Keep the `z.prettifyError`-like shape, but for tool args join the translated messages with the paths.
   - Tool `.describe()` texts for the LLM stay unchanged.
5. Tests:
   - `tests/i18n.test.ts`: vi and en have the same deep key set, and the same `{{placeholders}}` per key.
   - Update the existing tests that assert Vietnamese error substrings; they should still pass with language 'vi'.
   - Add one test that `setLanguage('en')` makes a past-reminder error English. Reset to 'vi' afterwards.

**As built (I1 deviations):**
- i18next 26 renamed `initImmediate` to `initAsync`; `createI18n` passes `initAsync: false`.
- `UserError` also translates its message at throw time, because IPC errors reach the renderer as `message` only. `errMsg` re-translates it in the current language.
- `tools/common.ts` adds `te(key, params)` (translate an `errors` key) and `tr(msg)` (translate `'errors:<key>'`, pass other text through). `parseArgs` and `settings:save` translate zod issues with `tr`; `parseArgs` still prints them with `z.prettifyError`.
- Also moved to `errors`: `db.ts` "newer version", the `safeStorage` error and the startup error-box title in `index.ts`. `settings:test`'s `(trống)` is `common:empty`.
- Unchanged, because only the LLM reads them: the tool results "Người dùng đã hủy thao tác này" and "…đã chỉnh sửa trước khi xác nhận", the `[ảnh #id]` labels and the settings test prompt. zod's built-in messages (e.g. "Invalid input") stay English in both languages.

## Task I2: UI settings, money style, default currency

1. `src/shared/types.ts`:
   - `UiSettings = { language: Lang; moneyStyle: 'vi' | 'intl'; defaultCurrency: string }` and `DEFAULT_UI`.
   - `SettingsView.ui`.
   - `Api.settings.setUi(patch: Partial<UiSettings>): Promise<UiSettings>`.
   - `Api.onUiChanged(cb)`.
2. `settings.ts`: `uiSettingsSchema` (currency trimmed, uppercased, `/^[A-Z]{3}$/`), and `getUi(db)`, which merges stored values over the defaults.
3. IPC `settings:setUi`: validate, merge, save, `setLanguage`, broadcast `ui:changed`, return the new settings. Main calls `setLanguage(getUi(db).language)` at startup.
4. `ToolCtx` gets `settings: () => UiSettings`. Wire it in ipc/agent deps and in test helpers (default `DEFAULT_UI`). `create_expense` defaults to `ctx.settings().defaultCurrency`.
5. `systemPrompt(db, now, ui?)`: the money rule mentions the default currency.
6. `shared/money.ts`: `formatMoney(amount, currency, style = 'vi')` uses the locale 'vi-VN' or 'en-US'.
7. `shared/dates.ts`: `recurrenceText(rule, t?)`, where the words come from `t`. Keep the Vietnamese default when there is no `t`, so existing tests still pass.
8. Tests: setUi validation, create_expense default currency, prompt currency, formatMoney styles, recurrenceText in en.

## Task I3: Renderer i18n and the Display settings card

1. `main.tsx`:
   - Await `api.settings.get()`.
   - Init the renderer instance with `ui.language`, wrapped in `I18nextProvider`.
   - Keep a `UiContext` (React context) with `ui` (moneyStyle, defaultCurrency).
   - Subscribe to `api.onUiChanged`: call `changeLanguage` and update the context.
2. `App.tsx`: the Arco locale is `viVN` or `enUS` by language, and the `UiProvider` labels come from `common` keys (vi or en).
3. Convert **every** user-visible string in `src/renderer/**` to `t()`:
   - App, the sider (including a translated default conversation title when the title equals the DB default), ChatPage, MessageList, SendBox (placeholder, slash descriptions, canned prompts, warnings), ConfirmCard (titles, field labels, value labels, status tags, buttons);
   - Thumbs, TodayPage, TasksPage, NotesPage, ExpensesPage, SettingsPage, useData (the confirm dialog texts);
   - pass `moneyStyle` to every `formatMoney`, and `t` to `recurrenceText`.
4. SettingsPage gets a new "Hiển thị / Display" SectionCard, applied immediately via `setUi`, with Message errors:
   - language Select;
   - money style Select, whose options show live examples;
   - default currency: an AutoComplete, or a Select with VND/USD/EUR/JPY plus custom input.
5. Verify: `grep` finds no Vietnamese characters left in `src/renderer/**/*.tsx` except the locale files. Take screenshots of every page with language 'en' and with 'vi': set it through a throwaway script on the dev DB, then restore it.

## Task I4: System strings (tray, toasts) and docs

1. Tray menu labels, tooltip and reminder toast title/body come from the main instance.
2. Update `docs/smoke-test.md` (a language toggle check) and the deviations/Known gaps in `docs/plan.md` if needed.
3. Final verification: typecheck, tests, build, pack.
