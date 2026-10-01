# Màu chủ đạo tuỳ chỉnh — thiết kế

Ngày: 2026-10-01. Liên quan: `docs/ui-refresh-design.md` (token màu, U6).

## Tóm tắt

- Thêm dòng **"Màu chủ đạo / App colour"** trong Cài đặt: 8 ô màu có sẵn (Đất nung mặc định) + 1 ô **Tuỳ chỉnh** mở bảng chọn màu.
- Một màu duy nhất điều khiển accent (nút, liên kết, mục đang chọn, viền focus, checkbox, bong bóng chat, nền nhạt) **và** sắc nền nhẹ (canvas, sidebar, đường kẻ, chữ phụ).
- Giữ hue người dùng chọn, nhưng tự chỉnh độ sáng riêng cho sáng/tối để chữ đạt AA (≥ 4.5:1). Chữ trên nút đổi đen/trắng như hiện tại.
- Lưu trong cài đặt `ui` hiện có, áp dụng ngay, đồng bộ mọi cửa sổ qua `ui:changed` (như ngôn ngữ).
- Không đổi: màu danh mục chi tiêu, `--danger`, giao diện theo hệ điều hành, font, bố cục.
- Ngoài phạm vi: màu riêng cho từng theme, thanh trượt độ đậm nền, sửa toàn bộ theme, nhập/xuất theme.

## Giả định

- App một người dùng, chạy local: hiệu năng/quy mô không đáng kể; chỉ tính lại khi màu đổi.
- Giá trị lưu sai → dùng mặc định; main kiểm tra hex ở ranh giới IPC.
- AA kiểm tra trên các nền accent thực sự nằm: canvas, surface, và nền nhạt của chính nó.
- Ô màu hiển thị màu **đã chỉnh** của theme hiện tại, không phải hex gốc.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| A1 | Ô có sẵn + Tuỳ chỉnh | Chỉ bảng chọn; chỉ ô có sẵn | An toàn mặc định mà vẫn tự do |
| A2 | Tự chỉnh độ sáng từng theme cho AA | Dùng đúng màu; dùng đúng + cảnh báo | Luôn đọc được, với mọi màu |
| A3 | Accent + sắc nền nhẹ, cố định | Chỉ accent; thanh trượt độ đậm | Cảm giác "theme" mà nền vẫn dịu |
| A4 | JS tính token, chèn một `<style>` | CSS thuần `oklch(from …)` | CSS không tạo được bộ ba `r, g, b` của Arco, không lặp được tới AA |
| A5 | `ColorPicker` của Arco + `@arco-design/color` | Thư viện mới; `<input type="color">` | Đã có sẵn, không thêm phụ thuộc; Arco có popup đồng bộ giao diện |
| A6 | Mặc định (Đất nung) không chèn gì | Tính lại cả mặc định | Giữ nguyên giá trị đã tinh chỉnh tay trong styles.css |
| A7 | Kéo trong bảng chọn = xem trước; lưu khi đóng; Esc hoàn tác | Lưu mỗi lần đổi | Tránh ghi DB liên tục khi kéo |
| A8 | Nền: giữ L, C hiện tại (OKLCH), thay hue; màu xám → C về 0 | Pha `color-mix` với accent | Giữ đúng độ tương phản đã duyệt của từng token |

## Thiết kế

### 1. Dữ liệu và Cài đặt

- `UiSettings.accent: string` (`#rrggbb`), mặc định `'#ab502d'`.
- `settings:setUi`: chấp nhận khi khớp `/^#[0-9a-f]{6}$/i`, chuyển chữ thường; sai thì từ chối như các giá trị UI khác. Đọc giá trị lưu sai → mặc định.
- `PreferenceRow` "Màu chủ đạo" (mô tả: "Nút, liên kết và điểm nhấn. Chữ được tự chỉnh để luôn dễ đọc."), cạnh Ngôn ngữ/Kiểu tiền.
- Hàng 8 ô tròn (~24px) dạng radio group (phím mũi tên; mỗi ô có tên: Đất nung, Biển, Lá xô thơm, Mận, Hồng, Hổ phách, Chàm, Đá phiến). Hex của ô có sẵn được tinh chỉnh để qua AA mà không cần chỉnh.
- Ô thứ 9 là `ColorPicker` của Arco (`disabledAlpha`), trigger là ô vòng cầu vồng (conic), tô màu tuỳ chỉnh khi màu không thuộc ô có sẵn.
- Ô đang chọn: vòng 2px màu `--ink` (không dùng accent, để thấy được với mọi màu).
- Ô có sẵn lưu khi bấm. Chọn Đất nung = đặt lại.

### 2. Tính màu — `src/renderer/accent.ts` (hàm thuần)

`accentCss(hex)` trả về CSS cho hai theme, hoặc `''` với mặc định. Có ~30 dòng chuyển đổi sRGB ↔ OKLCH và công thức tương phản WCAG.

1. **Accent**: giữ H, C. Sáng: giảm L từng bước tới khi ≥ 4.5:1 trên canvas (đã nhuộm), surface, và nền nhạt 10% trên sunken. Tối: tăng L với nền tối và nền nhạt 16%. Mỗi bước kẹp C vào gamut sRGB. `--on-accent` như cũ (trắng ở sáng, canvas tối ở tối) — đạt AA vì accent đã đạt trên các nền đó.
2. **Dải Arco**: `generate(accentĐãChỉnh, { list: true })` (`dark: true` cho tối) → `--primary-1…10` dạng `"r, g, b"`; ép `--primary-6` đúng bằng accent; `--link-*` vẫn trỏ về primary.
3. **Sắc nền**: với `--canvas --sunken --line --hover --ink --ink-2 --gray-1…10`, `--color-bg-3…5` (tối), `--thought-gradient`, màu bóng của `--shadow-card`: giữ L, C hiện tại, thay H bằng hue đã chọn. Màu gần xám (C < ~0.03) thì C giảm tỉ lệ về 0 → app xám trung tính. `--surface` sáng giữ trắng. Không đụng `--cat-*`, `--danger`.
4. Kết quả: hai khối `body{…}` và `body[arco-theme='dark']{…}`, đặt sau styles.css nên thắng.

### 3. Áp dụng

- `applyAccent(hex)`: tìm/tạo một `<style id="accent">` cuối `<head>`, gán `textContent = accentCss(hex)`. `accentCss` nhớ kết quả của hex gần nhất.
- `main.tsx`: gọi với `initial.accent` trước lần render đầu (không nháy màu đất nung), và trong `onUiChanged` cạnh `changeLanguage`.
- Bảng chọn gọi `applyAccent` trực tiếp khi kéo (xem trước), lưu khi đóng; `ui:changed` áp lại giá trị đã lưu. Esc → `applyAccent(saved)`.
- Đổi theme hệ điều hành: cả hai khối luôn có trong thẻ, không cần JS.

### 4. Trường hợp biên

- Đen/trắng/xám: nền xám; accent vẫn chỉnh L (gần đen ở sáng, gần trắng ở tối).
- Màu rất rực (`#00ff00`): kẹp gamut khi đổi L, không ra màu ngoài sRGB.
- Màu đất nung viết cứng ngoài token (vd. `#f6ebe4` trong `--thought-gradient` sáng): grep renderer, chuyển vào output token.

### 5. Kiểm thử

- `tests/accent.test.ts`: mọi ô có sẵn + `#ffff00 #000080 #000000 #ffffff #00ff00 #808080` → accent ≥ 4.5:1 trên canvas, surface, nền nhạt của nó, ở cả hai theme; chữ trên nút ≥ 4.5:1; mặc định trả `''`; thay hue bằng hue đất nung giữ canvas trong ΔE < 2 so với `#faf8f5`.
- Kiểm tra `setUi` từ chối `'red'`, `'#12345'`; chuyển chữ thường.
- i18n: khoá mới ở cả vi/en (test đồng bộ khoá hiện có).
- Ảnh chụp sáng/tối trang Hôm nay + Cài đặt trên profile nháp với Biển, Hổ phách, vàng tuỳ chỉnh.
- `docs/smoke-test.md`: chọn màu → khởi động lại → màu còn; Esc hoàn tác.

## As built

Commit `154f025` → `e864a5f`. Code là bản tham chiếu; mục này ghi những chỗ khác thiết kế.

- **Ô có sẵn** (sáng, đạt AA không cần chỉnh → tối sau chỉnh): Đất nung `#ab502d`, Biển `#2f6b86` → `#69a4c1`, Lá xô thơm `#4f6e52` → `#85a687`, Mận `#7e4a72` → `#c38ab5`, Hồng `#a3485e` → `#e07e93`, Hổ phách `#8a5a1c` → `#c69358`, Chàm `#4e57a0` → `#8b98e7`, Đá phiến `#56616e` → `#929eac`.
- **Nền nhạt để kiểm AA** là `accent-soft` trên `--surface` (không phải `--sunken`): trên sunken, đất nung chỉ 4.11:1; sidebar dùng chữ `--ink` ở đó (ui-refresh As built).
- **Dải Arco tối** sinh từ accent sáng (như Arco: bước 6 tối tự sáng hơn), rồi ép `--primary-6` = accent tối. Bước 6 và 7 có thể gần nhau.
- `--shadow-card` chỉ nhuộm ở theme sáng (bóng tối là đen). `--link-*` không ghi lại; date picker vẫn theo accent ở cả hai theme.
- `@arco-design/color` nằm trong `devDependencies` (renderer được bundle), kèm khai báo kiểu `src/renderer/arco-color.d.ts`.
- **Ô màu:** hiển thị `adjustAccent(hex, theme)`, theme lấy từ `useUi()` của `@aionui/ui`; ô Đất nung ở tối hiện màu tính ra (`#e3825f`), gần với `#e08a63` viết tay. Phím mũi tên vừa di chuyển vừa chọn (như radio gốc); tới ô Tuỳ chỉnh thì chỉ di chuyển. Popup bảng chọn mở `br` (ô nằm sát mép phải).
- Lưu thất bại sau khi xem trước → áp lại màu đã lưu và báo lỗi.
