# Kế hoạch: Làm mới giao diện

Thiết kế: `docs/ui-refresh-design.md` (U1–U17). Mỗi task: implementer → review spec → review chất lượng → commit.

## Quy ước chung

- Chạy lệnh ở `personal-assistant/`:
  - `bun run typecheck`
  - `bun run test` (vitest trên Node của Electron; bỏ qua dòng "Timeout terminating forks worker")
  - `bun run build`
- Code và comment tiếng Anh, giống văn phong hiện có. Chuỗi UI đi qua i18next: key mới thêm vào **cả** `src/shared/locales/vi.ts` và `en.ts` (`tests/i18n.test.ts` kiểm tra đủ key).
- **Style:**
  - Markup mới hoặc được làm lại dùng class UnoCSS (`presetWind3`, cú pháp giống Tailwind).
  - Màu chỉ dùng tên token (`bg-surface`, `text-ink-2`, `border-line`, `text-accent`…), không dùng màu cứng, không dùng biến thể `dark:` (U12).
  - Thứ Uno diễn đạt kém (override Arco, keyframe, `::after`, selector phức tạp) để trong `styles.css`.
  - Class cũ trong `styles.css` không còn ai dùng thì xóa trong cùng task.
- Không đổi tool, prompt, schema của bot. Không đổi markup của form và modal (`*Form.tsx`, `RecordModal`, `ImageField`).
- Mọi nút chỉ có icon phải có `aria-label`. Phần tử bấm được phải là `<button>`, không dùng `div onClick`.
- Commit message dạng `feat(ui): …` / `style(ui): …`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Không động vào dữ liệu thật ở `%APPDATA%/personal-assistant`.
- **Chụp màn hình** (có từ Task 1) dùng profile tạm đã seed (xem Task 1 bước 7):

  ```bash
  P=<scratch>/profile   # thư mục tạm, không phải %APPDATA%
  PA_THEME=light PA_SCREENSHOT_DELAY=5000 PA_SCREENSHOT=<scratch>/shots/today-light.png PA_PAGE=today \
    env -u ELECTRON_RUN_AS_NODE timeout 90 npx electron-vite dev -- --user-data-dir="$P" \
    --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
  ```

  `PA_PAGE` là `chat` (mặc định), `today`, `tasks`, `notes`, `expenses`, `reminders`, `settings`. Cuối mỗi task UI: chụp các trang liên quan ở `light` và `dark`, xem ảnh, sửa trước khi commit.

## Task 1: Nền tảng: UnoCSS, token, font, hook dev

**File:**
- mới: `uno.config.ts`, `src/renderer/assets/fonts/` (woff2 + `fonts.css` + `LICENSE`), `tests/seed-demo.test.ts`
- sửa: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `src/renderer/main.tsx`, `src/renderer/styles.css`, `src/main/index.ts`

1. `bun add -d --ignore-scripts unocss@66.10.5` (đúng bản đang có trong `node_modules`).
2. `uno.config.ts`:

   ```ts
   import { defineConfig, presetWind3 } from 'unocss';

   // Colors are the CSS variables from styles.css, so dark mode needs no `dark:` variants (design U12).
   const v = (name: string) => `var(--${name})`;

   export default defineConfig({
     presets: [presetWind3()],
     content: { pipeline: { include: [/src[\\/]renderer[\\/].*\.tsx($|\?)/] } },
     theme: {
       colors: {
         canvas: v('canvas'),
         surface: v('surface'),
         sunken: v('sunken'),
         line: v('line'),
         ink: { DEFAULT: v('ink'), 2: v('ink-2') },
         accent: { DEFAULT: v('accent'), soft: v('accent-soft'), on: v('on-accent') },
         danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
       },
       borderRadius: { card: '14px', ctl: '10px' },
       boxShadow: { card: v('shadow-card') },
     },
   });
   ```

   Không dùng modifier độ trong suốt (`bg-accent/50`) vì màu là `var()`; cần tông nhạt thì thêm token `*-soft`.
3. `electron.vite.config.ts`: `import UnoCSS from 'unocss/vite'` và `import uno from './uno.config'`, thêm `UnoCSS(uno)` vào đầu `renderer.plugins`. `tsconfig.json`: thêm `uno.config.ts` vào `include`.
4. `main.tsx`: thêm `import 'virtual:uno.css';` **sau** `@aionui/ui/arco-theme.css` và **trước** `./styles.css`, cùng `import './assets/fonts/fonts.css';` trước `styles.css`. Nếu typecheck báo thiếu module thì thêm `declare module 'virtual:uno.css';` vào một file `src/renderer/env.d.ts`.
5. **Font** Be Vietnam Pro, lấy từ gói `@fontsource/be-vietnam-pro` qua jsDelivr (curl chạy được qua proxy TLS):
   - `curl -sL https://cdn.jsdelivr.net/npm/@fontsource/be-vietnam-pro@5/{400,500,600,700}.css`. Mỗi file có các `@font-face` theo subset, kèm `unicode-range`.
   - Chỉ giữ subset `vietnamese`, `latin-ext`, `latin` (12 khối). Tải 12 file `.woff2` tương ứng từ `…@5/files/<tên>` về `src/renderer/assets/fonts/`.
   - Viết `fonts.css` gồm 12 khối đó, `url(./<tên>.woff2)`, thêm `font-display: swap`.
   - Tải `…@5/LICENSE` (OFL) vào cùng thư mục.
   - CSP đã cho `font-src 'self'`, không cần sửa `index.html`.
6. **Token** ở đầu `styles.css`. Arco khai báo biến màu trên `body` và `body[arco-theme='dark']`. Token của app, của `@aionui/ui` và của Arco đều đặt trên **đúng hai selector đó**: `styles.css` nạp sau cùng nên thắng khi cùng độ ưu tiên, và giá trị trên `body` đè token `html` của thư viện cho mọi phần tử con.

   ```css
   /* ---- Design tokens (docs/ui-refresh-design.md §1) ----
      On body, like Arco's own variables: loaded last, so these win over Arco and over @aionui/ui's html-level tokens. */
   body {
     --canvas: #faf8f5;
     --surface: #ffffff;
     --sunken: #f3efea;
     --line: #e7e1d9;
     --ink: #2b2622;
     --ink-2: #746a62;
     --accent: #b5552f; /* white text ~4.9:1; #c8643b would be ~3.9:1 (design U6) */
     --on-accent: #ffffff;
     --accent-soft: color-mix(in srgb, var(--accent) 10%, transparent);
     --danger: rgb(var(--danger-6));
     --danger-soft: color-mix(in srgb, rgb(var(--danger-6)) 10%, transparent);
     --hover: #f1ede8;
     --shadow-card: 0 1px 2px rgba(43, 38, 34, 0.04), 0 8px 24px -12px rgba(43, 38, 34, 0.14);

     /* @aionui/ui */
     --bg-base: var(--surface);
     --bg-1: var(--canvas);
     --bg-2: var(--sunken);
     --bg-3: var(--line);
     --bg-hover: var(--hover);
     --bg-active: var(--line);
     --text-primary: var(--ink);
     --color-text-1: var(--ink);
     --text-secondary: var(--ink-2);
     --primary: var(--accent);
     --border-base: var(--line);
     --border-light: var(--hover);
     --message-user-bg: var(--accent-soft);
     --dialog-fill-0: var(--surface);
     --fill-0: var(--surface);
     --thought-gradient: linear-gradient(90deg, #f6ebe4 0%, var(--sunken) 100%);

     /* Arco: terracotta primary and warm gray ramps (r,g,b like Arco's own) */
     --primary-1: 250, 238, 231;
     --primary-2: 244, 217, 202;
     --primary-3: 234, 184, 160;
     --primary-4: 221, 148, 116;
     --primary-5: 203, 114, 79;
     --primary-6: 181, 85, 47;
     --primary-7: 153, 68, 36;
     --primary-8: 124, 53, 27;
     --primary-9: 94, 39, 19;
     --primary-10: 64, 26, 12;
     --gray-1: 247, 245, 242;
     --gray-2: 241, 237, 232;
     --gray-3: 231, 225, 217;
     --gray-4: 214, 206, 197;
     --gray-5: 190, 181, 171;
     --gray-6: 158, 149, 139;
     --gray-7: 128, 119, 110;
     --gray-8: 99, 91, 83;
     --gray-9: 69, 62, 56;
     --gray-10: 43, 38, 34;
   }
   body[arco-theme='dark'] {
     --canvas: #1a1714;
     --surface: #23201c;
     --sunken: #1f1c19;
     --line: #34302b;
     --ink: #ede7e1;
     --ink-2: #a39a91;
     --accent: #e08a63;
     --on-accent: #1a1714; /* white on #e08a63 is ~2.5:1; this is ~6.8:1 */
     --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
     --danger-soft: color-mix(in srgb, rgb(var(--danger-6)) 16%, transparent);
     --hover: #2a2622;
     --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.55);
     --thought-gradient: linear-gradient(135deg, #3a2a22 0%, var(--surface) 100%);
     --color-bg-1: var(--canvas);
     --color-bg-2: var(--surface);
     --color-bg-3: #2a2622;
     --color-bg-4: #302b27;
     --color-bg-5: #36312c;
     --color-border: var(--line);
     --primary-1: 58, 36, 27;
     --primary-2: 88, 50, 35;
     --primary-3: 125, 69, 45;
     --primary-4: 163, 93, 61;
     --primary-5: 196, 115, 80;
     --primary-6: 224, 138, 99;
     --primary-7: 232, 160, 127;
     --primary-8: 239, 184, 158;
     --primary-9: 245, 210, 193;
     --primary-10: 251, 236, 228;
     --gray-1: 26, 23, 20;
     --gray-2: 35, 32, 28;
     --gray-3: 52, 48, 43;
     --gray-4: 68, 63, 57;
     --gray-5: 90, 84, 77;
     --gray-6: 118, 110, 102;
     --gray-7: 150, 141, 132;
     --gray-8: 180, 171, 162;
     --gray-9: 210, 203, 196;
     --gray-10: 237, 231, 225;
   }
   html,
   body {
     font-family: 'Be Vietnam Pro', system-ui, sans-serif;
   }
   /* Arco paints these white-on-primary-6; the dark accent is too light for that. */
   .arco-btn-primary:not(.arco-btn-disabled),
   .arco-btn-primary:not(.arco-btn-disabled):not(.arco-btn-loading):is(:hover, :active),
   .arco-picker-cell-selected .arco-picker-date-value,
   .arco-picker-cell-selected:hover .arco-picker-date-value,
   .arco-checkbox-checked:not(.arco-checkbox-disabled) .arco-checkbox-mask-icon {
     color: var(--on-accent);
   }
   ```

   Giữ nguyên `body { background: var(--bg-1) }` hiện có (giờ là `canvas`). Các token `--primary-*` của Arco đang trỏ tới `--arcoblue-*`; khai báo trực tiếp như trên thì đè được.
7. **Hook dev**:
   - `src/main/index.ts`, trước khi tạo cửa sổ: `if (!app.isPackaged && (process.env.PA_THEME === 'light' || process.env.PA_THEME === 'dark')) nativeTheme.themeSource = process.env.PA_THEME;` (`prefers-color-scheme` của renderer đi theo). Thêm `PA_THEME` vào comment của hook screenshot.
   - `tests/seed-demo.test.ts`: chỉ chạy khi có `PA_SEED_DB` (`describe.skipIf(!process.env.PA_SEED_DB)`, giống cách eval test opt-in).
     - `openDb(path)`, `ro = new DatabaseSync(path, { readOnly: true })`, ctx `{ db, ro, now: () => new Date(), settings: () => DEFAULT_UI }`, rồi gọi `callTool` từ `tests/helpers.ts`.
     - Dữ liệu tính theo ngày hôm nay (`toLocalDate()`, `addDays`):
       - 8 task: 2 quá hạn, 3 hôm nay (1 ưu tiên cao, 1 lặp hằng tuần), 2 sắp tới, 1 không hạn; công việc và cá nhân.
       - 5 ghi chú, 1 nhật ký, 1 ghi chú dài hơn 400 ký tự.
       - 14 khoản chi trong tháng này: 6 danh mục, 1 khoản USD, trải trên 5 ngày.
       - 5 nhắc nhở: 2 hôm nay (giờ sau hiện tại), 1 ngày mai, 2 trong 7 ngày.
     - Đọc schema tool trong `src/main/tools/*.ts` để viết đúng tham số.
     - Cách dùng: `mkdir -p $P && PA_SEED_DB=$P/assistant.db bun run test tests/seed-demo.test.ts`.
8. **Kiểm tra:**
   - `typecheck`, `test`, `build` xanh.
   - Chụp `chat`, `today`, `tasks`, `expenses`, `settings` ở light và dark:
     - màu nhấn là đất nung
     - nền xám ấm
     - font mới có dấu tiếng Việt đúng
     - chữ trên nút primary đọc được ở dark
     - modal, select, datepicker không còn xanh
   - Bố cục cũ vẫn chạy (mới đổi màu).
9. Commit `style(ui): warm design tokens, Be Vietnam Pro and UnoCSS`.

## Task 2: Đổi tên hội thoại + hàm thuần cho ngày

**File:**
- sửa: `src/main/store.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/shared/dates.ts`, `tests/store.test.ts`, `tests/dates.test.ts`

TDD: viết test trước, chạy thấy đỏ, rồi mới code.

1. **Test** trong `tests/store.test.ts`:

   ```ts
   it('renames a conversation: trims, collapses spaces, caps at 100 code points, rejects empty', () => {
     const { db } = testDb();
     const c = createConversation(db);
     renameConversation(db, c, '  Kế   hoạch  tuần  ');
     expect(listConversations(db)[0].title).toBe('Kế hoạch tuần');
     renameConversation(db, c, 'a'.repeat(120));
     expect(listConversations(db)[0].title).toBe('a'.repeat(100));
     expect(() => renameConversation(db, c, ' \n ')).toThrow(UserError);
     setTitleIfNew(db, c, 'auto'); // a renamed conversation is never auto-titled
     expect(listConversations(db)[0].title).toBe('a'.repeat(100));
   });
   ```

2. `store.ts`:

   ```ts
   /** A user-chosen title; setTitleIfNew never overwrites it because it is no longer the default. */
   export function renameConversation(db: Db, id: number, title: string): void {
     const t = [...title.normalize('NFC').replace(/\s+/g, ' ').trim()].slice(0, 100).join('');
     if (!t) throw new UserError('invalidValue');
     db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(t, id);
   }
   ```

   Không đụng `updated_at`: đổi tên không đẩy hội thoại lên đầu danh sách.
3. `ipc.ts`, cạnh `conv:remove`: `ipcMain.handle('conv:rename', (_e, convId: unknown, title: unknown) => { if (typeof title !== 'string') throw new UserError('invalidValue'); renameConversation(m.db, id(convId), title); })`. Kênh tên `conv:rename` cho khớp các kênh `conv:*` sẵn có.
4. `types.ts`: thêm `rename(id: number, title: string): Promise<void>;` vào `Api.conversations`. `preload`: `rename: (id, title) => invoke('conv:rename', id, title)`.
5. **Test** trong `tests/dates.test.ts`, cho ba hàm mới:
   - `dayBucket` với `today = '2026-09-30'`: ISO của hôm nay → `today`; hôm qua → `yesterday`; 7 ngày trước → `week`; 8 ngày trước → `older`. Dùng `new Date(2026, 8, 29, 23, 30).toISOString()` để kiểm tra theo giờ địa phương.
   - `relativeDay`: `'2026-09-30'` → `today`, `'2026-10-01'` → `tomorrow`, `'2026-09-29'` → `yesterday`, `'2026-10-02'` → `null`.
   - `partOfDay`: 5:00 và 11:59 → `morning`, 12:00 và 17:59 → `afternoon`, 18:00 và 2:00 → `evening`.
6. `dates.ts`:

   ```ts
   export type DayBucket = 'today' | 'yesterday' | 'week' | 'older';
   /** Sidebar group of a conversation's updated_at, in local days (design §2). */
   export function dayBucket(iso: string, today: string): DayBucket {
     const day = toLocalDate(new Date(iso));
     if (day === today) return 'today';
     if (day === addDays(today, -1)) return 'yesterday';
     return day >= addDays(today, -7) ? 'week' : 'older';
   }

   /** 'today' / 'tomorrow' / 'yesterday' for a local date, else null (the caller shows weekday + date). */
   export function relativeDay(date: string, today: string): 'today' | 'tomorrow' | 'yesterday' | null {
     if (date === today) return 'today';
     if (date === addDays(today, 1)) return 'tomorrow';
     return date === addDays(today, -1) ? 'yesterday' : null;
   }

   export const partOfDay = (d: Date): 'morning' | 'afternoon' | 'evening' =>
     d.getHours() >= 5 && d.getHours() < 12 ? 'morning' : d.getHours() >= 12 && d.getHours() < 18 ? 'afternoon' : 'evening';
   ```

7. `test` xanh. Commit `feat(chat): rename conversations; date helpers for the UI refresh`.

## Task 3: Khung app: top bar, nav, danh sách hội thoại, phím tắt

**File:**
- mới: `src/renderer/components/Nav.tsx`, `src/renderer/components/ConversationList.tsx`
- sửa: `src/renderer/App.tsx`, `src/renderer/chat/ChatPage.tsx`, `src/renderer/chat/SendBox.tsx`, `styles.css`, locales

1. **Bố cục `App`** (thay `.titlebar` + `.app-body`):

   ```tsx
   <div className='flex h-full bg-canvas text-ink'>
     <aside className={`sider flex flex-col bg-sunken border-r border-line ${collapsed ? 'w-16' : 'w-60'}`}>
       <div className='drag h-11 flex items-center gap-2 px-3'>{/* app name (hidden when collapsed) + collapse button (no-drag) */}</div>
       {/* new chat pill, <Nav>, <ConversationList> (hidden when collapsed), settings <Nav> item at the bottom */}
     </aside>
     <div className='flex-1 min-w-0 flex flex-col'>
       <header className='drag h-11 flex items-center justify-between pl-6'>
         <h1 className='m-0 text-[15px] font-600 truncate'>{title}</h1>
         <WindowControls … />
       </header>
       <main className='content'>{/* pages as now */}</main>
     </div>
   </div>
   ```

   - `styles.css`: `.drag { -webkit-app-region: drag }`, và các nút, input bên trong vùng kéo có `-webkit-app-region: no-drag`.
   - `title`: chat → `titleOf(conversation)`; trang khác → `t('nav.<page>')`.
   - `transition: width .25s var(--ease-out)` trên `.sider`.
   - Xóa `.titlebar*`, `.app`, `.app-body`, `.sider*` cũ trong `styles.css`.
2. **`Nav.tsx`**:

   ```ts
   export type NavItem = { key: string; icon: ReactNode; label: string; shortcut?: string };
   export function Nav({ items, selected, collapsed, onSelect }: { items: NavItem[]; selected?: string; collapsed: boolean; onSelect: (key: string) => void })
   ```

   - `<nav>` gồm các `<button type='button'>`: `flex items-center gap-3 h-9 px-3 rounded-ctl text-ink-2 hover:bg-[var(--hover)] hover:text-ink`.
   - Mục đang chọn: `bg-accent-soft text-accent font-500`, có `aria-current='page'`.
   - `focus-visible`: ring 2px màu accent. Thêm một rule chung trong `styles.css` cho `:focus-visible` của button tự làm.
   - Khi `collapsed`: chỉ icon, căn giữa, bọc `Tooltip` của Arco (`position='right'`, nội dung là nhãn + phím tắt), `aria-label={label}`.
   - Nhãn dài: `truncate`.
3. **`ConversationList.tsx`**. Props: `conversations`, `selectedId`, `titleOf`, `onOpen(id)`, `onRename(id, title): Promise<void>`, `onDelete(c)`.
   - Nhóm bằng `dayBucket(c.updated_at, toLocalDate())` theo thứ tự today → yesterday → week → older. Nhóm rỗng thì ẩn. Nhãn nhóm: key mới `chat:group.today|yesterday|week|older`.
   - Mỗi mục là một hàng: `<button>` tiêu đề (`truncate`, `title={đầy đủ}`) và nút "⋯" (`More` của icon-park, `aria-label={t('chat:conversationMenu', { title })}`).
     - Nút "⋯" có `opacity-0`, hiện khi hàng `:hover` hoặc `:focus-within` (rule `.conv-row` trong `styles.css`).
     - Nút "⋯" mở `Dropdown` của Arco (`trigger='click'`) có `Menu`: Đổi tên (`Edit`), Xóa (`Delete`, danger).
   - **Đổi tên:** state `editing: number | null`, `draft: string`.
     - Hàng đang sửa hiện `Input` của Arco (`size='small'`, `autoFocus`, chọn sẵn toàn bộ chữ).
     - Enter hoặc blur: nếu `draft.trim()` rỗng hoặc bằng tiêu đề cũ thì chỉ thoát; ngược lại `await onRename`, lỗi thì hiện `message.error` và giữ ô nhập.
     - Escape: thoát. Double-click vào nút tiêu đề cũng bắt đầu đổi tên.
     - Bản nháp nằm trong state của component, nên không mất khi `conversations` refresh.
   - Dùng `AionScrollArea` như hiện tại cho vùng cuộn.
4. **`App`:**
   - `renameConversation = async (id, title) => { await api.conversations.rename(id, title); await refresh(); }`.
   - Bỏ import `SiderItem`.
   - Nút hội thoại mới: `<button>` pill `bg-accent-soft text-accent rounded-ctl h-9`, icon `Plus`, nhãn + `<kbd>` "Ctrl+N" (ẩn khi collapsed, lúc đó chỉ còn icon + Tooltip).
5. **Thu gọn:** `collapsed` khởi tạo từ `localStorage.getItem('pa.siderCollapsed') === '1'`, ghi lại khi đổi. Cả hai thao tác bọc try/catch.
6. **Phím tắt:** một `useEffect` gắn `keydown` lên `window`.
   - Chỉ xử lý khi `e.ctrlKey && !e.altKey && !e.shiftKey`.
   - Bỏ qua khi có modal của Arco đang mở: `[...document.querySelectorAll('.arco-modal-wrapper')].some((el) => getComputedStyle(el).display !== 'none')`.
   - `n` → `newChat()`; `1`…`5` → today, tasks, notes, expenses, reminders; `,` → settings; `b` → toggle `collapsed`. Mỗi phím khớp thì gọi `e.preventDefault()`.
7. **Mở chat và focus ô soạn tin:**
   - Route chat mang thêm `focus?: boolean`.
   - `App` truyền `go(page)` cho các trang (dùng ở Task 5): `go('chat')` chạy `openLatest()` rồi đặt `focus: true`.
   - `ChatPage` nhận `autoFocus` và truyền xuống `SendBox`, rồi xuống `Input.TextArea` (`autoFocus`).
8. **Locales:**
   - `chat:group.*`, `chat:rename` ("Đổi tên" / "Rename"), `chat:conversationMenu` ("Tùy chọn: {{title}}" / "Options: {{title}}").
   - `common:collapseSidebar` / `common:expandSidebar`.
9. **Kiểm tra:**
   - Chụp `chat` và `today`, light và dark, sidebar mở và thu gọn. Để chụp khi thu gọn, tạm gọi `localStorage.setItem` trong DevTools hoặc chạy lại sau khi bấm; không cần hook mới.
   - Tab qua nav và hội thoại: có focus ring; Enter mở trang; "⋯" hiện khi focus.
   - Đổi tên bằng menu và bằng double-click. Phím tắt chạy, và không chạy khi đang mở form.
10. Commit `feat(ui): app shell with top bar, accessible nav, grouped conversations, rename and shortcuts`.

## Task 4: Thành phần dùng chung

**File:**
- mới: `src/renderer/components/ui.tsx`
- sửa: `styles.css`, `src/renderer/useData.tsx` (Skeleton), tất cả `pages/*Page.tsx` (thay `Empty` và `SettingsPageHeader`), locales

1. `ui.tsx` chỉ chứa các component trình bày nhỏ, không state:
   - `PageToolbar({ hint?, children })`: `flex flex-wrap items-center justify-between gap-3 mb-5`. Bên trái là `hint` (`text-[13px] text-ink-2`), bên phải là các action. Thay `SettingsPageHeader` ở mọi trang (tiêu đề đã lên top bar). Cài đặt cũng dùng.
   - `EmptyState({ icon, title, hint?, children? })`: căn giữa (`flex flex-col items-center text-center py-16`), icon trong vòng tròn `w-14 h-14 rounded-full bg-accent-soft text-accent`, tiêu đề `text-[15px] font-600`, hint `text-ink-2`, `children` là các nút CTA. Thay mọi `Empty` của Arco trong các trang.
   - `Card({ title?, count?, action?, children, className? })`: `bg-surface border border-line rounded-card shadow-card`. Header tùy chọn gồm tiêu đề, `count` (badge `.count` cũ viết lại bằng Uno) và `action` bên phải. Dùng `<section>` + `<h2>` cho header để trình đọc màn hình có cấu trúc.
   - `Chip({ tone = 'neutral', icon?, children })`: `inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs`. Tông: `neutral` (`bg-sunken text-ink-2`), `accent` (`bg-accent-soft text-accent`), `danger` (`bg-danger-soft text-danger`).
   - `StatCard({ icon, value, label, tone? })`: `Card` với icon trong ô vuông bo góc, `value` cỡ `text-2xl font-600 tabular-nums`, `label` màu `text-ink-2`. `tone='danger'` tô icon và số màu danger.
2. **Hàng trong thẻ.** Rule trong `styles.css` (dùng cho `<div className='list-row'>` bên trong `Card`):
   - `display:flex; align-items:center; gap:10px; padding:10px 16px; border-top:1px solid var(--line)`, bỏ border ở hàng đầu.
   - `:hover { background: var(--hover) }`.
   - `.row-actions { opacity:0; transition: opacity .15s }`, và `.list-row:hover .row-actions, .list-row:focus-within .row-actions { opacity:1 }` (U17).
   - Giữ `.is-done` / `.is-closed` và animation `rise` của `.row` cũ cho `.list-row`, rồi xóa `.row`, `.group-title`, `.count` khi không còn chỗ dùng (sau Task 6).
3. **Segmented control.** Rule cho `.arco-radio-group-type-button`:
   - Nền `var(--sunken)`, `border-radius: 10px`, `padding: 3px`, không viền.
   - Nút con trong suốt, `border-radius: 8px`.
   - Nút đang chọn: nền `var(--surface)`, chữ `var(--ink)`, `box-shadow: var(--shadow-card)`.
   - Bỏ đường ngăn `::before` giữa các nút.
4. **Checkbox tròn:** `.arco-checkbox-mask { border-radius: 50% }` và màu tick là accent (Arco đã dùng `primary-6`).
5. **Skeleton:** thêm `Skeleton` dạng `variant='cards'` (4 khối cao 88px trong lưới giống StatCard) cho Hôm nay. Biến thể mặc định giữ như cũ.
6. **Locales:** tiêu đề empty state được đưa vào từng trang ở các task sau. Ở task này chỉ thay `Empty` bằng `EmptyState` với chữ cũ.
7. **Kiểm tra:** chụp mọi trang light và dark. Không trang nào còn `SettingsPageHeader`, `Empty` của Arco hay h1 lớn. Commit `feat(ui): shared page toolbar, cards, chips, empty states and segmented filters`.

## Task 5: Trang Hôm nay dạng dashboard

**File:** sửa `src/renderer/pages/TodayPage.tsx`, `src/renderer/App.tsx` (truyền `go`), locales.

1. `TodayPage({ go }: { go: (page: 'chat') => void })`. Dữ liệu và `read` giữ nguyên.
2. **Lời chào:**
   - `h2` `text-2xl font-600 tracking-tight`: `t('greeting.<partOfDay(new Date())>')`.
   - Dòng phụ: ngày dạng dài (hàm `longDate` hiện có), rồi tóm tắt `[t('sumTasks', {count}), t('sumOverdue', {count}), t('sumReminders', {count})]`, bỏ các phần có count 0, nối bằng " · ". Dùng plural của i18next (`_one` / `_other` cho en; vi chỉ cần `_other`, xem cách `confirmAll` đang làm).
3. **Stat card** trong `grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]`:
   - Quá hạn (`Caution`, `tone='danger'` khi > 0)
   - Việc hôm nay (`CheckOne`)
   - Nhắc nhở hôm nay (`Remind`)
   - Đã chi hôm nay (`Wallet`; giá trị là chuỗi `spent` hiện có, `text-xl` nếu dài hơn 12 ký tự)
4. **Hành động nhanh** (`flex flex-wrap gap-2`), là các nút pill:
   - "Hỏi trợ lý" (`Comment`, `bg-accent text-accent-on`) → `go('chat')`
   - "+ Task", "+ Chi tiêu", "+ Nhắc nhở" (`bg-surface border border-line`)
   - State `adding: 'task' | 'expense' | 'reminder' | null` render `TaskForm task={null} categories={[...data.tasks_today, ...data.overdue].map((x) => x.category)}`, `ExpenseForm expense={null} categories={[]}`, `ReminderForm reminder={null}`. `onClose` đặt lại `null`.
   - `useData` đã tự tải lại khi có `data:changed` (`useData.tsx:38`), không cần gọi thêm.
5. **Hai thẻ** trong `grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]` (tự xếp chồng khi hẹp):
   - `Card title={t('tasksCard')} count={…}`: các hàng quá hạn rồi hôm nay, dùng `list-row` và `taskRows` hiện có (ngày quá hạn là `Chip tone='danger'`).
   - `Card title={t('remindersCard')}`: hôm nay, rồi 7 ngày tới. Giờ đặt trong pill `tabular-nums`.
   - Thẻ rỗng hiện dòng `text-ink-2 px-4 py-3`: `t('noTasksToday')` / `t('noRemindersSoon')`.
6. **Cả ngày trống** (không có task, quá hạn hay nhắc nhở): thay stat card + hai thẻ bằng `EmptyState icon={<Sun />} title={t('todayFreeTitle')} hint={t('todayFreeHint')}` với CTA "+ Task" và "Hỏi trợ lý". Lời chào vẫn hiện.
7. **Đang tải:** `Skeleton variant='cards'` rồi `Skeleton`.
8. **Locales mới:**
   - `pages:greeting.morning|afternoon|evening` ("Chào buổi sáng" / "Good morning"…)
   - `sumTasks`, `sumOverdue`, `sumReminders` (plural)
   - `statOverdue`, `statTasks`, `statReminders`, `statSpent`
   - `askAssistant`, `addTask`, `addExpense`, `addReminder`
   - `tasksCard`, `remindersCard`, `noTasksToday`, `noRemindersSoon`, `todayFreeTitle`, `todayFreeHint`
   - Xóa key không còn dùng (`todayEmpty`, `spentToday` nếu hết chỗ dùng, `tasksToday`…). `tests/i18n.test.ts` phải vẫn xanh.
9. **Kiểm tra:** chụp `today` light và dark với dữ liệu seed, và một lần với profile trống (không seed) để xem empty state. Thử ở cửa sổ 800px: hai thẻ xếp chồng, stat card xuống hàng. Commit `feat(today): dashboard with greeting, stats, quick actions and cards`.

## Task 6: Trang Task và Nhắc nhở dạng thẻ

**File:** sửa `src/renderer/pages/TasksPage.tsx`, `src/renderer/pages/RemindersPage.tsx`, `styles.css`, locales.

1. **Task:**
   - `PageToolbar hint={t('tasksHint')}` chứa hai `Radio.Group` (tự thành segmented nhờ Task 4) và nút `+ Thêm`.
   - Mỗi nhóm (overdue / today / upcoming / noDate) là một `Card title count`. Chế độ không phải `todo` là một `Card` không tiêu đề.
   - Hàng `list-row`:
     - checkbox
     - `row-main`: nút tiêu đề `.link`, dòng chip gồm hạn (`Chip`, `tone='danger'` khi quá hạn), ưu tiên (Cao = danger, Thấp = neutral, thường = không hiện), danh mục (neutral, có chấm `w-1.5 h-1.5 rounded-full bg-current`), lặp lại (icon `Refresh`, text `recurrenceText`)
     - `notes` là dòng `text-ink-2 text-[13px] line-clamp-2`
     - `Thumbs`
     - `div.row-actions` chứa Sửa và Xóa
   - Bỏ `Tag` của Arco ở trang này.
   - Empty: `EmptyState icon={<CheckOne />} title={t('noTasks')} hint={t('noTasksHint')}` với CTA `+ Thêm` (mở form thêm).
2. **Nhắc nhở:**
   - Tiêu đề nhóm ngày: `relativeDay(day, toLocalDate())` → `t('common:today'|'tomorrow'|'yesterday')`. Ngược lại hiện `${weekdayLong}, ${d}/${m}`. Viết hàm `dayTitle(date, t)` trong `src/renderer/components/ui.tsx` để Chi tiêu dùng lại.
   - Hàng: pill giờ (`tabular-nums text-[13px] px-2 h-6 rounded-md bg-sunken`), nội dung (nút `.link`), `Chip` trạng thái khi `status === 'all'`, nút Bỏ qua (luôn hiện với `pending`), `row-actions` chứa Sửa và Xóa.
   - Empty: `EmptyState icon={<Remind />}` với CTA `+ Thêm`.
3. Sau task này `.row`, `.group-title`, `.count`, `.muted` (nếu hết chỗ dùng) bị xóa khỏi `styles.css`. Kiểm tra bằng grep toàn bộ `src/renderer`.
4. **Locales:** `common:today`, `tomorrow`, `yesterday` (nếu chưa có), `pages:noTasksHint`, `noRemindersHint`.
5. **Kiểm tra:** chụp `tasks` và `reminders` light và dark. Tab tới một hàng: Sửa và Xóa hiện ra. Hoàn thành một task vẫn gạch ngang rồi biến mất. Commit `feat(tasks,reminders): card lists with chips and hover actions`.

## Task 7: Ghi chú dạng lưới thẻ

**File:** sửa `src/renderer/pages/NotesPage.tsx`, `styles.css`, locales.

1. `PageToolbar` chứa `AionSearchInput` (`flex-1 max-w-[480px]`) bên trái và `+ Thêm` bên phải. Bỏ `style={{ marginTop: 12 }}`.
2. Lưới `grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`. Mỗi ghi chú là `article.note-card` (`relative flex flex-col gap-2 p-4 bg-surface border border-line rounded-card shadow-card transition hover:-translate-y-0.5`):
   - Hàng trên: `Chip tone='accent'` "Nhật ký" nếu `kind === 'journal'`, và `div.row-actions` (Sửa, Xóa) ở góc phải.
   - Tiêu đề: `<button className='link note-open'>` (`font-600 text-left line-clamp-2`).
   - Đoạn trích: `text-ink-2 text-[13px] line-clamp-4`, giữ `highlight()`. Bỏ `onClick` trên đoạn trích: lớp phủ đã lo.
   - `Thumbs`, rồi chân thẻ `mt-auto text-xs text-ink-2` là ngày `when()`.
   - **Stretched link (U16)** trong `styles.css`:
     - `.note-open::after { content:''; position:absolute; inset:0; border-radius:inherit }`
     - `.note-card .row-actions, .note-card .thumbs { position:relative; z-index:1 }`
     - `.note-card:focus-within { outline: 2px solid var(--accent) }` khi focus vào tiêu đề.
3. Empty:
   - Có tìm kiếm: `EmptyState icon={<Search />} title={t('noNotesFound')}`.
   - Không tìm kiếm: `EmptyState icon={<Notes />} title={t('noNotes')} hint={t('noNotesHint')}` với CTA `+ Thêm`.
4. Skeleton: lưới 6 khối cao 140px (`Skeleton variant='grid'`).
5. **Kiểm tra:** chụp `notes` light và dark. Bấm vào vùng trống của thẻ mở ghi chú; bấm Xóa không mở ghi chú. Commit `feat(notes): card grid with stretched-link cards`.

## Task 8: Chi tiêu: tổng quan và danh sách theo ngày

**File:**
- mới: `tests/breakdown.test.ts`
- sửa: `src/shared/money.ts`, `src/renderer/pages/ExpensesPage.tsx`, `styles.css`, locales

**Trước khi làm:** nạp skill `dataviz` và làm theo nó cho bảng màu, thanh và chú thích.

1. **Test trước** (`tests/breakdown.test.ts`) cho `breakdown(items, top = 6)`:
   - 8 danh mục VND và 1 khoản USD → hai nhóm tiền, nhóm lớn nhất trước.
   - VND có 6 phần + `other` (tổng của 2 danh mục nhỏ nhất).
   - `share` cộng lại bằng 1 (sai số 1e-9).
   - Danh mục xếp giảm dần.
   - Danh sách rỗng → `[]`.
2. `money.ts`:

   ```ts
   export type Breakdown = { currency: string; total: number; parts: { category: string | null; total: number; share: number }[] };
   /** Per currency, largest first; categories past `top` fold into one part with category null ("Other"). */
   export function breakdown(items: { category: string; currency: string; amount: number }[], top = 6): Breakdown[] {
     const byCur = new Map<string, Map<string, number>>();
     for (const e of items) {
       const m = byCur.get(e.currency) ?? new Map<string, number>();
       m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
       byCur.set(e.currency, m);
     }
     return [...byCur]
       .map(([currency, m]) => {
         const sorted = [...m].sort((a, b) => b[1] - a[1]);
         const total = sorted.reduce((s, [, v]) => s + v, 0);
         const rest = sorted.slice(top).reduce((s, [, v]) => s + v, 0);
         const parts = sorted.slice(0, top).map(([category, v]) => ({ category, total: v, share: v / total }));
         if (rest) parts.push({ category: null, total: rest, share: rest / total });
         return { currency, total, parts };
       })
       .sort((a, b) => b.total - a.total);
   }
   ```

   Tổng nhiều loại tiền "lớn nhất trước" so sánh số minor giữa các loại tiền khác nhau. Đây là quy ước trình bày, không phải quy đổi; ghi `ponytail:` comment nếu cần.
3. **Toolbar:** nút `Left` / `Right` (text, có `aria-label` là tháng trước / tháng sau) ở hai bên nhãn tháng "Tháng 9, 2026". Nhãn là nút mở `DatePicker.MonthPicker` có sẵn (`triggerElement` là nút đó, hoặc giữ picker `size='small'` nếu `triggerElement` không hợp). `+ Thêm` bên phải.
4. **Thẻ tổng quan** (`Card`, `p-5`):
   - Tổng: `text-3xl font-600 tabular-nums`, là `money(b[0].total, b[0].currency)`. Các loại tiền còn lại là `+ …` cỡ `text-base text-ink-2`.
   - Mỗi `Breakdown` một thanh: `div.flex.h-3.rounded-full.overflow-hidden.gap-[2px]` gồm các đoạn `style={{ flexGrow: share, background: color(i) }}`, có `aria-hidden`.
   - **Màu:** biến CSS `--cat-1…6`, `--cat-other` cho light và dark trong khối token.
     - Điểm xuất phát: light `#B5552F #5B8A72 #C9A227 #6B7FB8 #A0627E #4E9AA6`, other `#B8AFA6`; dark là phiên bản sáng hơn.
     - Kiểm tra bằng validator của skill `dataviz` rồi chỉnh.
     - Màu gán theo thứ hạng trong tháng, không theo tên danh mục.
   - **Chú thích:** lưới `grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`. Mỗi mục là `<button aria-pressed={filter === category}>` gồm chấm màu, tên (`null` → `t('otherCategory')`), số tiền, phần trăm (`Math.round(share * 100)%`). Phần "Khác" không lọc được (nút `disabled` hoặc là `div`).
5. **Lọc:** state `filter: string | null`, đặt lại khi đổi tháng. Khi đang lọc: `Chip tone='accent'` "✕ {category}" (là `<button>`) cạnh tiêu đề danh sách, bấm để bỏ.
6. **Danh sách theo ngày** (U14): thay `Table`.
   - Nhóm `data.items` (đã lọc) theo `spent_at`, ngày mới nhất trước. Mỗi ngày là một `Card` với tiêu đề `dayTitle(date, t)` (từ Task 6) và `action` là tổng ngày theo từng loại tiền.
   - Hàng `list-row`: `Chip` danh mục, mô tả (`.link`, `—` nếu trống, mở form sửa), `Thumbs`, số tiền (`ml-auto tabular-nums font-500`), `row-actions` chứa Sửa và Xóa.
   - Bỏ `byCategory` và `Tag` cũ.
7. **Empty:** `EmptyState icon={<Wallet />} title={t('noExpensesMonth')} hint={t('noExpensesHint')}` với CTA `+ Thêm`. Không có thẻ tổng quan khi tháng trống.
8. **Locales:** `prevMonth`, `nextMonth`, `monthLabel` ("Tháng {{m}}, {{y}}" / dùng `toLocaleDateString('en', { month: 'long', year: 'numeric' })` cho en qua key có tham số), `otherCategory`, `clearFilter`, `noExpensesMonth`, `noExpensesHint`. Xóa `date`, `categoryColumn`, `amount`, `image` nếu hết chỗ dùng.
9. **Kiểm tra:** `test` xanh (có `breakdown`). Chụp `expenses` light và dark với seed (6 danh mục + USD): màu phân biệt được ở cả hai theme, lọc chạy, tháng trống hiện empty state (lùi về tháng trước). Commit `feat(expenses): month summary with category breakdown and day-grouped list`.

## Task 9: Chat và Cài đặt

**File:** sửa `src/renderer/chat/MessageList.tsx`, `src/renderer/chat/SendBox.tsx`, `src/renderer/chat/ConfirmCard.tsx`, `src/renderer/pages/SettingsPage.tsx`, `styles.css`, locales.

1. **Tin nhắn:**
   - `.msg-list` rộng tối đa `760px`.
   - `.msg-user`: nền `var(--message-user-bg)` (đã là `accent-soft`), chữ `var(--ink)`, bo `18px 18px 6px 18px`.
2. **Hội thoại trống:**
   - `.chat-empty` căn giữa theo chiều dọc: `.messages` là flex, `.msg-list` có `min-height:100%`, và `.chat-empty` dùng `margin:auto 0`; bỏ `16vh`.
   - `h2` 26px.
   - Gợi ý là lưới `grid-cols-3` (xuống 1 cột dưới 640px). Mỗi thẻ có icon riêng: `homnay` → `Sun`, `tuannay` → `CalendarThirtyTwo`, `chitieu` → `Wallet`, trong ô `bg-accent-soft text-accent`.
3. **Ô soạn tin:**
   - `.sendbox-inner` nền `var(--surface)`, bo 18px.
   - Nút Ảnh chỉ icon (`type='text'`, `aria-label={t('attachImage')}`, bọc `Tooltip`).
   - Nút Gửi tròn `shape='circle' type='primary' icon={<Send />} aria-label={t('send')}`. Nút Dừng cũng tròn, `status='warning'`, `aria-label={t('stop')}`.
   - `placeholder` đổi nội dung thành "Nhắn cho trợ lý…" / "Message the assistant…".
   - Thêm dòng gợi ý dưới khung: `<div className='max-w-[860px] mx-auto mt-1.5 px-1 text-xs text-ink-2'>{t('composerHint')}</div>` ("Enter gửi · Shift+Enter xuống dòng · / lệnh nhanh · dán hoặc kéo ảnh vào").
4. **Thẻ xác nhận:** thêm icon theo tool ở `.confirm-title`:
   - `*_task*` → `CheckOne`
   - `*note*` → `Notes`
   - `*expense*` → `Wallet`
   - `*reminder*` → `Remind`
   - còn lại → `Edit`

   Dùng một hàm `toolIcon(name)` trong file. Nền `.confirm-card` đổi thành `var(--surface)`. Giữ nguyên hành vi.
5. **Cài đặt:**
   - Dùng `PageToolbar` (từ Task 4) thay `SettingsPageHeader`.
   - `SectionCard` của thư viện: nếu nền của nó lẫn với `canvas`, override `.settings` để thẻ dùng `var(--surface)` + `border` + `shadow-card`.
   - Chụp lại, rồi xóa hack `:where(.arco-input…)` trong `.settings` nếu ô nhập đã tách khỏi nền; giữ nếu vẫn cần.
6. **Kiểm tra:**
   - Chụp `chat` (trống và có tin nhắn, dùng một hội thoại seed nếu có thể; nếu không thì chỉ trống), và `settings`, light và dark.
   - Tab tới nút Gửi: có tên đọc được.
   - Commit `style(chat,settings): warm chat bubbles, composer and settings cards`.

## Task 10: Hoàn thiện

1. Chạy `typecheck`, `test`, `build`. Chụp **mọi trang ở light và dark**, và ở cửa sổ 800×560 (sidebar mở). Không có tràn ngang, chữ bị cắt hay nút đè nhau.
2. Grep `src/renderer` tìm màu cứng (`#[0-9a-f]{3,6}`, `rgb(` ngoài `styles.css`), `SiderItem`, `SettingsPageHeader`, `Empty` của Arco, và class chết trong `styles.css`. Dọn.
3. `docs/ui-refresh-design.md`: thêm mục **As built** (khác biệt so với thiết kế, vd kênh `conv:rename`, màu biểu đồ cuối cùng, phần đã bỏ).
4. `docs/plan.md` → Known gaps: ghi rằng nav của app đã dùng được bằng bàn phím; `WindowControls` vẫn còn aria-label tiếng Anh.
5. `docs/smoke-test.md`: thêm bước kiểm tra:
   - phím tắt
   - đổi tên hội thoại
   - thu gọn sidebar
   - hành động nhanh trên Hôm nay
   - lọc theo danh mục ở Chi tiêu
   - dark mode (đổi theme Windows)
6. Review toàn bộ diff (`/code-review`) rồi sửa. Commit `docs: UI refresh as built and smoke-test steps`.
