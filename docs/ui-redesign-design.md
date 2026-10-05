# Thiết kế lại giao diện (UI/UX redesign): Design

Ngày: 2026-10-05 · Trạng thái: đã duyệt (brainstorming), đã implement

Làm lại toàn bộ giao diện theo bản thiết kế của chủ dự án (một artifact Claude Design: sidebar có ⌘K và Capture, các trang Today / Chat / Tasks / Notes / Expenses / Reminders / Settings, welcome flow, sáng/tối, 6 màu nhấn, vi/en, khung mac/win). **Không bỏ tính năng nào** của app: PDF theo batch và viewer, reasoning, LM Studio, tìm file, ảnh, thẻ xác nhận và thẻ hỏi, slash command, màu nhấn tùy chỉnh, luồng cập nhật, tray, nhắc nhở.

Nhánh nền: `test/mac-all` cộng `feat/pdf-batch-reasoning` (xem mục 7).

---

## 1. Understanding summary

- **Làm gì:** dựng lại khung chung và 7 trang theo thiết kế, thêm các phần thiết kế có mà app chưa có: **⌘K** (tìm và nhảy), **Capture ⌘J** (ghi nhanh), panel ngữ cảnh của chat, biểu đồ chi tiêu, lịch tuần nhắc nhở, editor ghi chú Viết/Chia đôi/Xem trước, Settings có menu con và trang Phím tắt, welcome flow.
- **Vì sao:** làm app trông và dùng hiện đại, theo thiết kế của chủ dự án.
- **Cho ai:** một người dùng; macOS làm kỹ trước, Windows và Linux giữ cơ chế khung cửa sổ hiện có (nút cửa sổ riêng).
- **Nền tảng:** lai. Khung, trang, thẻ, biểu đồ, lịch tuần, palette, viewer là component riêng theo token của thiết kế; Arco chỉ còn cho DatePicker, Select, Modal và form thêm/sửa, được phủ lại bằng biến CSS; Markdown/KaTeX/mermaid của `@aionui/ui` giữ nguyên.
- **Capture:** quy tắc cục bộ (tiếng Việt và Anh), xem trước trực tiếp thứ sắp tạo, Enter lưu thẳng (D7), toast có Hoàn tác.
- **Non-goals:** tính năng LLM mới, thay đổi backend ngoài vài truy vấn đọc cho màn mới, huy hiệu "Made with Claude Design" và dữ liệu mẫu của prototype, iMessage (nhánh riêng), thư viện biểu đồ.

## 2. Assumptions

1. Dữ liệu cho màn mới lấy từ truy vấn đọc: tool `expense_months` (tổng theo tháng và loại tiền) cho biểu đồ và so với tháng trước. ⌘K tìm trên task, ghi chú và hội thoại bằng các tool đọc sẵn, hoàn toàn cục bộ.
2. Giao diện là cài đặt **Theo máy / Sáng / Tối** (`ui.theme`), áp qua `nativeTheme.themeSource` nên `prefers-color-scheme` của renderer luôn đúng. Màu nhấn là 6 màu của thiết kế (ocean mặc định) và **ô chọn màu tùy chỉnh được giữ**.
3. Welcome flow (3 bước) hiện lần đầu khi chưa cấu hình model và chưa `welcomed`; mở lại từ Settings hoặc ⌘K. Người dùng cũ đã có model không thấy nó.
4. Font Be Vietnam Pro (có sẵn) cộng JetBrains Mono (cho số, ngày, giờ, mã; lấy từ file có trong thiết kế, OFL). Icon chuyển sang `lucide-react`.
5. Danh mục chi tiêu là chữ tự do: icon suy ra theo từ khóa (`categoryKeyOf`), màu theo hạng trong tháng như trước.
6. Hiệu năng không nặng hơn đáng kể; giữ bàn phím và `aria`; tương phản đạt AA ở cả sáng và tối (kiểm bằng test).
7. Tính năng app có mà thiết kế chưa vẽ được đặt vào đúng phong cách thiết kế (mục 4, "Chỗ cho những gì thiết kế chưa vẽ").
8. Một PR lớn, commit theo bước.

## 3. Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| U1 | Phạm vi: làm lại mọi màn và thêm cả Capture, giữ mọi tính năng | Chỉ đổi giao diện; hoặc bỏ Capture | Người dùng chọn |
| U2 | Capture bằng quy tắc cục bộ, xem trước trực tiếp, lưu thẳng, Hoàn tác | Form xác nhận; nhờ LLM | Tức thì, offline, không gửi gì ra ngoài; D7 (thao tác trực tiếp không cần xác nhận) |
| U3 | Nền tảng lai: component riêng + Arco cho ô nhập phức tạp | Chỉ phủ theme; bỏ hẳn Arco và `@aionui/ui` | Khớp thiết kế mà không làm hỏng chức năng (DatePicker, Markdown với KaTeX/mermaid) |
| U4 | Nhánh nền `test/mac-all` + `feat/pdf-batch-reasoning` | Từ `main`; từ nhánh PDF | Có đủ logo mới, sửa macOS, LM Studio, PDF, reasoning |
| U5 | Token màu là biến CSS trên `body` (`tokens.css`), tên cũ (`--canvas`, `--surface`…) trỏ về tên mới | Đổi tên mọi chỗ dùng | Code cũ và thư viện vẫn chạy; Uno dùng màu theo biến nên sáng/tối không cần `dark:` |
| U6 | Màu nhấn: 6 preset của thiết kế với màu sáng và tối riêng (OKLCH), hex chỉnh tối thiểu để đạt AA; màu tùy chỉnh vẫn qua bộ giải tương phản | Chỉ một màu cho cả hai theme | Preset đẹp ở cả hai theme và luôn đọc được |
| U7 | `theme` thành cài đặt (`system`/`light`/`dark`), đặt `nativeTheme.themeSource` ở main | Chỉ theo hệ điều hành | Một nguồn sự thật cho cả khung cửa sổ và media query |
| U8 | Đếm giờ của `ThoughtDisplay` giữ nguyên | Tự viết | Đã có sẵn (xem pdf-batch-reasoning-design P13) |
| U9 | Ghi chú sửa trực tiếp trong khung (tự lưu sau 0,9 giây), form modal vẫn có cho loại ghi chú và ảnh | Chỉ form modal | Đúng thiết kế (editor Viết/Chia đôi/Xem trước) mà không mất việc quản lý ảnh |
| U10 | Xem trước ghi chú dùng Markdown của app, tách riêng dòng checklist `- [ ]` để tick được | Trình render riêng của prototype | Giữ bảng, code, math; checklist tick được như thiết kế |
| U11 | Lịch tuần chỉ đọc 7 ngày tới (kể cả đã nhắc, hiện mờ); danh sách giữ bộ lọc trạng thái và lịch sử 90 ngày | Thay hẳn danh sách | Giữ tính năng cũ, thêm cái thiết kế vẽ |
| U12 | Tasks: tab Đang mở / Hôm nay / Sắp tới / Đã xong / Đã hủy / Tất cả, cộng bộ lọc loại | Chỉ 4 tab của thiết kế | Không mất trạng thái Đã hủy và Tất cả |
| U13 | Chi tiêu: giữ nhiều loại tiền (mỗi loại một thanh), lọc theo danh mục; thêm biểu đồ 6 tháng và so với tháng trước theo loại tiền lớn nhất của tháng | Bỏ nhiều loại tiền | Không mất tính năng |
| U14 | Palette tìm task và ghi chú qua tool đọc sau 120ms, hội thoại tại chỗ; chọn task mở form sửa, ghi chú mở trong trang Ghi chú | Tìm trước toàn bộ | Nhẹ, không giữ dữ liệu thừa |
| U15 | Toast tự dựng (một thông báo, có nút Hoàn tác); lỗi vẫn dùng Arco Message | Dùng Arco Message cho cả hai | Cần nút hành động và đúng giao diện |
| U16 | Welcome và Settings dùng chung `useModelForm` / `ModelForm` | Hai bản riêng | Một logic cho Azure, gateway, LM Studio |
| U17 | Thêm IPC `settings:dataPath` và `settings:revealData` cho "Thư mục dữ liệu" | Bỏ mục này | Có trong thiết kế |
| U18 | Đèn giao thông macOS dời xuống `y: 17` để căn giữa hàng đầu 48px của sidebar | Giữ `y: 10` | Khớp thiết kế |
| U19 | Bỏ `rose` và `slate` khỏi tên màu nhấn | Giữ | Thiết kế chỉ có 6 màu; khóa i18n dư gây nhiễu |

## 4. Thiết kế

### Token và theme

`tokens.css` đặt trên `body`: `--chrome` (nền cửa sổ và sidebar), `--panel` (panel chính, thẻ, ô nhập), `--sunken`, `--line`, `--hover`, `--pill`, `--ink / --ink-2 / --ink-3`, `--danger / --ok` và bản `-soft`, `--shadow-sm / --shadow / --shadow-lg`, bảng màu danh mục `--c1…c7`. `--accent`, `--on-accent` và dải `--primary-*` của Arco do `accent.ts` ghi; `--accent-soft` (11%) và `--acc-line` (38%) là `color-mix` từ `--accent`. Sáng/tối đổi bằng `body[arco-theme='dark']` (đồng thời `data-theme`). `uno.config.ts` lấy màu theo các biến này.

### Khung

Sidebar rộng 256px (68px khi thu gọn): ô tìm (⌘K), Hội thoại mới, 5 trang kèm số đếm (Today = quá hạn + hôm nay, Tasks = đang mở, Reminders = đang chờ), hội thoại theo ngày (đổi tên, xóa như trước), Settings kèm chấm trạng thái model. Thanh trên 48px: ẩn/hiện sidebar, tiêu đề, **Ghi nhanh ⌘J**, nút panel ngữ cảnh (chỉ ở chat), nút cửa sổ riêng trên Windows/Linux. Panel chính bo 12px có viền. Banner cập nhật, ⌘K, Ghi nhanh, Welcome và toast là lớp phủ.

### Capture

`shared/capture.ts` (thuần, có test): `detectKind` (note: / số tiền có đơn vị / giờ hoặc từ nhắc / còn lại task), `parseCapture` (tiền `45k`, `1.2tr`, `1tr2`, `45.000đ`, `$12.5`; giờ `3pm`, `9h30`, `15:30`, `7 giờ rưỡi`, `3h chiều`; ngày `mai`, `ngày kia`, thứ, `12/10`, `ngày 15`; danh mục theo từ khóa hoặc theo danh mục đã có), `captureToolCall` và `UNDO_TOOL`. Nhắc nhở không nêu ngày thì là hôm nay nếu giờ còn ở phía trước, ngược lại là ngày mai; giờ đã qua mà nêu rõ ngày thì báo `past`. Thứ trong tuần là lần kế tiếp, không bao giờ là hôm nay. Dòng xem trước nói rõ thứ sắp lưu hoặc vì sao chưa lưu được. Tab đổi loại; gõ tay đổi loại thì ngừng đoán.

### Các trang

Today (lời chào, thanh Capture, 4 thẻ số liệu bấm được, Việc cần làm, Sắp tới), Chat (3 cột: cuộc trò chuyện, composer có nhãn model, panel ngữ cảnh; thẻ xác nhận và thẻ hỏi có header, hàng, chân thẻ), Tasks, Notes (hai khung), Expenses (tổng, so với tháng trước, biểu đồ 6 tháng bấm để chuyển tháng, theo danh mục, danh sách theo ngày kèm icon), Reminders (tuần/danh sách), Settings (Hiển thị, Mô hình AI, Cập nhật, Hệ thống, Phím tắt).

### Chỗ cho những gì thiết kế chưa vẽ

Sửa task/chi tiêu/nhắc nhở: modal Arco phủ lại (bo 16px, bóng sâu) mở khi bấm tiêu đề hàng, nút sửa và xóa hiện khi rê chuột. Đổi tên hoặc xóa hội thoại: menu "⋯" ở hàng hội thoại. Chip PDF, thẻ PDF và viewer, khối reasoning, tiến độ batch: phong cách thẻ và chip của thiết kế. Tìm file: nút "Tìm file" trong composer. Slash command: menu nổi trên composer. Ảnh đính kèm (thumbs) và trường ảnh trong form giữ nguyên.

## 5. Kiểm thử

Logic thuần có unit test: `capture` (detect, tiền, giờ, ngày, danh mục, ghi chú, ánh xạ tool), `palette` (xếp hạng), `checklist` (tách và tick), `accent` (AA ở hai theme cho 6 preset và màu tùy chỉnh, preset giữ nguyên, không ghi neutrals), `settings` (theme, welcomed, hàng cũ không có hai trường này), `expense_months`. Giao diện được kiểm bằng app Electron thật (build `out/`, tải qua `file://`) điều khiển qua Chrome DevTools Protocol với dữ liệu demo (`tests/seed-demo.test.ts`): chụp mọi trang ở sáng/tối, ⌘K, ⌘J, thu gọn sidebar, welcome, chat với LM Studio thật (reasoning và PDF theo batch) và đối chiếu với thiết kế.

## 6. Rủi ro đã chấp nhận

- Một PR rất lớn; diff kèm các PR chưa merge (mục 7).
- `Markdown` của `@aionui/ui` dựng trong shadow DOM nên một số chỉnh CSS bên ngoài không tới được; xem trước ghi chú dùng kiểu mặc định của nó.
- Windows và Linux chưa được chạy thử trên máy thật (chỉ macOS); khung cửa sổ dùng nút riêng của thiết kế.
- Ô chọn màu tùy chỉnh và các modal form vẫn là Arco, nên hơi khác thiết kế ở chi tiết nhỏ.

## 7. Thứ tự merge

PR này dựng trên `test/mac-all` và `feat/pdf-batch-reasoning`, nên diff kèm commit của các PR còn mở: #5, #7, #9 (macOS), #10 (logo), #12 (đồng bộ nút), #13 (LM Studio), #16 (PDF và reasoning). Merge theo thứ tự đó rồi mới merge PR này; sau đó diff của nó chỉ còn phần giao diện mới.
