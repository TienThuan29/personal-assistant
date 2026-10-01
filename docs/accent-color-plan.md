# Kế hoạch: Màu chủ đạo tuỳ chỉnh

Thiết kế: `docs/accent-color-design.md` (A1–A8). Mỗi task: implementer → review (spec + chất lượng) → sửa → commit.

## Quy ước chung

Như `docs/ui-refresh-plan.md` § "Quy ước chung" (lệnh `bun run typecheck` / `test` / `build`, i18n đủ hai file, class UnoCSS theo token, commit có `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, không đụng `%APPDATA%/personal-assistant`, lệnh chụp màn hình với profile tạm). Thêm:

- Profile tạm đã seed: `<scratchpad>/demo-profile`. Chỉ kill process Electron có `--user-data-dir` trỏ vào profile tạm; **không bao giờ** `taskkill /IM electron.exe`.
- Không thêm thư viện mới. `@arco-design/color@0.4.0` đã có trong `node_modules` (phụ thuộc của Arco) — chỉ khai báo trực tiếp: `bun add --ignore-scripts @arco-design/color@0.4.0`.

## Task 1: Lưu cài đặt `accent`

**File:** `src/shared/types.ts`, `src/main/settings.ts`, `tests/settings.test.ts`

1. `UiSettings` thêm `accent: string`; `DEFAULT_UI.accent = '#ab502d'`. Comment: `#rrggbb`, chữ thường; xem accent-color-design.
2. `uiSettingsSchema` thêm `accent: z.string({ error: 'errors:invalidValue' }).trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'errors:invalidValue')`.
   - Hàng lưu sai vẫn đọc ra mặc định (hành vi `getUi` hiện có, cả hàng). Hàng cũ không có `accent` → lấy mặc định nhờ `{ ...DEFAULT_UI, ...stored }`.
3. Test: sửa các `toEqual` liệt kê đủ trường (dòng ~113–114) cho có `accent`; thêm: `saveUi({ accent: '#3366AA' })` → `'#3366aa'`; từ chối `'red'`, `'#12345'`, `'#1234567'`, `123`, giữ giá trị cũ; hàng cũ không có `accent` đọc ra `'#ab502d'`.
4. typecheck + test. Commit `feat(settings): store an app accent colour`.

## Task 2: Tính token — `src/renderer/accent.ts` (hàm thuần) + test

**File:** mới `src/renderer/accent.ts`, `tests/accent.test.ts`; sửa `package.json`

Xuất:

- `PRESETS: { key: string; hex: string }[]` — 8 ô: `terracotta` (`#ab502d`, đầu tiên), `ocean`, `sage`, `plum`, `rose`, `amber`, `indigo`, `slate`. Chọn hex sao cho `adjust` **không** phải đổi chúng ở theme sáng (test kiểm tra), và nhìn dịu như đất nung.
- `accentCss(hex: string): string` — `''` khi `hex === DEFAULT_UI.accent`; còn lại hai khối `body{…}` và `body[arco-theme='dark']{…}`. Nhớ kết quả của hex gần nhất (một biến, không cần cache).
- `applyAccent(hex: string): void` — tìm/tạo `<style id="accent">` ở **cuối** `<head>` (append lại nếu có thẻ khác đứng sau, vì Vite chèn CSS lúc dev), gán `textContent`.
- Hàm nội bộ (xuất để test): `toOklch`, `fromOklch` (kẹp gamut sRGB bằng cách giảm C), `contrast(a, b)` (WCAG), `adjustAccent(hex, theme)`.

Thuật toán (chi tiết trong design §2):

1. Màu nền đã nhuộm trước (accent kiểm tra trên các nền này). Danh sách neutral sáng/tối chép từ `styles.css` (`--canvas --sunken --line --hover --ink --ink-2 --gray-1…10`, tối thêm `--color-bg-3…5`). Với mỗi màu: giữ L, C; H = hue của màu chọn; C nhân `min(1, Cchọn / 0.03)`. `--surface` sáng giữ `#fff`; `--surface` tối nhuộm như neutral.
2. Accent: giữ H, C; sáng giảm L từng bước 0.005, tối tăng L, tới khi ≥ 4.5:1 trên canvas, surface và nền nhạt (sáng: accent 10% trên sunken; tối: 16% trên sunken) — trộn sRGB giống `color-mix(in srgb …)`. Dừng ở L = 0 / 1 (luôn đạt vì đen/trắng).
3. `--on-accent`: sáng `#ffffff`, tối = canvas tối đã nhuộm. Test khẳng định ≥ 4.5:1.
4. `--primary-1…10` từ `generate(accent, { list: true, dark, format: 'rgb' })`, đổi `rgb(r, g, b)` → `r, g, b`; `--primary-6` = accent đúng giá trị. `--link-*` đã trỏ về primary trong styles.css — không ghi lại, **trừ** khối tối nếu Arco khai báo lại sau (kiểm tra bằng ảnh chụp date picker).
5. Ghi cả: `--accent`, `--on-accent`, các neutral đã nhuộm, `--gray-*` dạng `r, g, b`, `--shadow-card` (màu bóng sáng `rgba(r,g,b,…)` từ ink đã nhuộm), `--thought-gradient` (sáng: `color-mix(in srgb, var(--accent) 8%, var(--canvas))` → `var(--sunken)`; tối tương tự với nền tối). `--accent-soft`, `--pill`, `--bg-*` tự theo vì là `var()`.

Test (`tests/accent.test.ts`, chạy trên Node của Electron, không cần DOM):

- Với mọi preset + `#ffff00 #000080 #000000 #ffffff #00ff00 #808080 #3366aa`, cả hai theme: accent ≥ 4.5:1 trên canvas, surface, nền nhạt; on-accent ≥ 4.5:1 trên accent. (Parse lại từ chuỗi CSS trả về, để test đúng thứ được chèn.)
- `accentCss('#ab502d') === ''`.
- Preset ở theme sáng: `adjustAccent(p.hex, 'light') === p.hex`.
- Nhuộm với hue đất nung: canvas sáng ΔE (OKLab, ×100) < 2 so với `#faf8f5`.
- `#808080`: canvas sáng có C ≈ 0.
- Round-trip `fromOklch(toOklch(x)) === x` cho vài hex.

typecheck + test. Commit `feat(ui): compute accent and tinted neutral tokens`.

## Task 3: Áp dụng + Cài đặt

**File:** `src/renderer/main.tsx`, `src/renderer/pages/SettingsPage.tsx`, `src/renderer/styles.css`, `src/shared/locales/vi.ts`, `en.ts`

1. `main.tsx`: `applyAccent(initial.accent)` trước `createRoot(...).render`, và trong handler `onUiChanged` cạnh `changeLanguage`. Bọc try/catch như chỗ khởi tạo khác (lỗi tính màu không được làm trắng cửa sổ).
2. `DisplayCard`: `PreferenceRow` mới đầu card hoặc sau Ngôn ngữ, `label={t('accent')}`, `description={t('accentDesc')}`, con là component `AccentPicker` (cùng file).
3. `AccentPicker`:
   - `<div role="radiogroup" aria-label={t('accent')}>` gồm 8 `<button role="radio" aria-checked aria-label={t(`accentName.${key}`)}>` tròn 24px, nền = màu đã chỉnh của theme hiện tại (dùng `adjustAccent` với theme từ `document.body.getAttribute('arco-theme')`, hoặc đơn giản dùng hex gốc nếu preset đã qua AA — preset đạt ở sáng nên chỉ khác ở tối; chọn cách ngắn hơn và ghi lại).
   - Roving tabindex + phím mũi tên trái/phải (chỉ ô đang chọn có `tabIndex=0`).
   - Ô thứ 9: `ColorPicker` (Arco) `disabledAlpha`, `format='hex'`, `triggerElement` = nút tròn cùng cỡ, nền `conic-gradient(...)` khi màu hiện tại là preset, nền màu tuỳ chỉnh khi không phải; `aria-label={t('accentCustom')}`, cũng `role="radio"` trong group.
   - Bấm preset → `setUi({ accent })`. Picker: `onChange` → `applyAccent(v)` (xem trước) + lưu vào ref; `onVisibleChange(false)` → nếu Esc thì `applyAccent(ui.accent)`, không thì `setUi({ accent: ref })` khi khác `ui.accent`. Bắt Esc bằng `keydown` trên `document` (capture) khi popup mở.
   - Ô đang chọn: `outline: 2px solid var(--ink); outline-offset: 2px`. Focus-visible dùng outline sẵn có.
4. CSS phần swatch trong `styles.css` chỉ khi Uno không diễn đạt được (conic-gradient có thể dùng `[background:conic-gradient(...)]`).
5. i18n (cả vi/en): `settings.accent` ("Màu chủ đạo" / "App colour"), `settings.accentDesc` ("Nút, liên kết và điểm nhấn. Chữ được tự chỉnh để luôn dễ đọc." / "Buttons, links and highlights. Text is adjusted to stay readable."), `settings.accentCustom` ("Màu tuỳ chỉnh" / "Custom colour"), `settings.accentName.{terracotta…slate}` (Đất nung/Terracotta, Biển/Ocean, Lá xô thơm/Sage, Mận/Plum, Hồng/Rose, Hổ phách/Amber, Chàm/Indigo, Đá phiến/Slate).
6. Kiểm tra bằng tay qua CDP hoặc ảnh chụp trên profile tạm: đặt `accent` trong DB profile tạm (hoặc chọn trong UI) → chụp `today` + `settings` + `expenses` ở light/dark với Biển, Hổ phách, `#ffff00`. Xem: nút, liên kết date picker, mục chọn sidebar, bong bóng chat, nền nhuộm; màu danh mục chi tiêu không đổi.
7. typecheck + test + build. Commit `feat(settings): app colour picker`.

## Task 4: Hoàn thiện

- `docs/smoke-test.md`: bước chọn màu preset → đổi ngay ở mọi trang; tuỳ chỉnh → kéo xem trước, Esc hoàn tác, đóng lưu; khởi động lại → còn màu; đổi theme hệ điều hành → vẫn đọc được; chọn Đất nung → như cũ.
- `docs/accent-color-design.md`: thêm mục "As built" (khác biệt so với thiết kế, hex preset cuối cùng).
- `docs/plan.md` Known gaps nếu có giới hạn mới.
- Commit `docs: app colour as built and smoke-test steps`.
