# Làm mới giao diện (UI refresh)

Ngày: 2026-09-30 · Trạng thái: đã duyệt

## Tóm tắt

- Hiện đại hóa renderer của app: giao diện mới **"ấm và dịu"** (nền xám ấm, màu nhấn đất nung, font Be Vietnam Pro) cùng các cải thiện UX có chọn lọc. Giữ nguyên các trang, luồng dữ liệu và hành vi của bot.
- Mục đích: app chạy tốt nhưng trông như một trang admin Arco mặc định. Nó nên giống một người bạn đồng hành hằng ngày, dễ chịu và mang tính cá nhân.
- Người dùng: một người, trên Windows, dùng tiếng Việt hoặc tiếng Anh, sáng hoặc tối theo hệ điều hành.
- Phạm vi UX:
  - Trang Hôm nay thành dashboard.
  - Sidebar gọn hơn: nav tự làm và dùng được bằng bàn phím, hội thoại nhóm theo ngày, đổi tên hội thoại, thu gọn sidebar.
  - Title bar hợp nhất.
  - Task, Ghi chú, Nhắc nhở dạng thẻ; Ghi chú dạng lưới.
  - Chi tiêu có tổng tháng và biểu đồ theo danh mục.
  - Empty state có nút hành động.
  - Phím tắt.
- Ràng buộc: chỉ sửa renderer; `@aionui/ui` và Arco được đổi giao diện qua CSS variable. Ngoại lệ duy nhất là IPC `conversations:rename` ở main.
- **Không làm:** sửa thư viện hay tarball, thêm trang mới, đổi bot, prompt hay data model (ngoài cập nhật title), công tắc giao diện sáng/tối thủ công, command palette.

## Giả định

1. **Hiệu năng:** chuyển động chỉ bằng CSS, không thêm thư viện chạy lúc runtime. Font là file `.woff2` nằm trong app (4 độ đậm, khoảng 150 KB). Biểu đồ vẽ bằng CSS, không dùng thư viện chart.
2. **Khả năng tiếp cận:** chữ và màu nhấn đạt tương phản WCAG AA ở cả hai theme. Focus ring nhìn thấy được, tôn trọng `prefers-reduced-motion`, mọi nút chỉ có icon giữ `aria-label`.
3. **Quy mô:** dữ liệu cá nhân (vài trăm dòng), không cần virtualization.
4. **Độ tin cậy:** mọi test hiện có vẫn pass, thêm test cho rename. Mỗi trang được chụp màn hình kiểm tra ở cả sáng và tối.
5. **Bảo trì:** token màu khai báo một lần trong `styles.css`; component dùng token, không dùng màu cứng.
6. Trạng thái thu gọn sidebar lưu ở `localStorage` (tiện ích giao diện, không cần vào DB).
7. Nhóm hội thoại: Hôm nay / Hôm qua / 7 ngày qua / Cũ hơn, theo `updated_at` giờ địa phương.

## Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| U1 | Làm mới giao diện + sửa UX có chọn lọc | Chỉ đổi giao diện; làm lại toàn bộ UX | Người dùng chọn |
| U2 | Hướng "ấm và dịu" | Tối giản sắc nét (kiểu Linear); kính mờ rực rỡ | Người dùng chọn; hợp với app cá nhân |
| U3 | Chỉ sửa renderer, override thư viện qua CSS variable | Sửa cả `@aionui/ui` rồi đóng gói lại tarball | Người dùng chọn; token của thư viện và Arco đều override được |
| U4 | Theme vẫn theo hệ điều hành, làm đẹp cả hai | Thêm công tắc Sáng/Tối/Hệ thống | Người dùng chọn |
| U5 | Font Be Vietnam Pro, file nằm trong app | Font hệ thống (Segoe UI); Inter | Thiết kế cho dấu tiếng Việt; chạy offline; không thêm dependency npm |
| U6 | Màu nhấn đất nung `#B5552F` (tối: `#E08A63`) | Xanh xô thơm; chàm ấm | Người dùng chọn. Chọn tông đậm hơn `#C8643B` vì chữ trắng trên `#C8643B` chỉ đạt ~3.9:1 (trượt AA), trên `#B5552F` đạt ~4.9:1 |
| U7 | Làm cả 4 cải thiện UX + nav tự làm, empty state có CTA, phím tắt, title bar hợp nhất | Chỉ làm một phần | Người dùng chọn |
| U8 | Thêm IPC `conversations:rename` (ngoại lệ của U3) | Bỏ tính năng đổi tên | Người dùng chọn; thay đổi nhỏ ở main |
| U9 | **Hướng B**: UnoCSS cho markup của app + lớp token CSS variable cho Arco/thư viện | A: token + CSS thuần + vài component; C: build lại theme Arco bằng Less | Người dùng chọn B. Utility class không đổi được CSS bên trong Arco/thư viện, nên lớp token vẫn cần |
| U10 | UnoCSS + `presetWind3` | Tailwind CSS v4 | Cùng engine với `@aionui/ui`, đã có trong `node_modules` (66.x, không cần tải qua proxy TLS), class giống Tailwind |
| U11 | Chỉ chuyển sang utility phần markup được làm lại | Chuyển toàn bộ | Người dùng chọn; form và modal không đổi markup |
| U12 | Màu theme trong Uno trỏ tới CSS variable, không dùng biến thể `dark:` | Mỗi class hai bản `x dark:y` | Dark mode chỉ đến từ token; class ngắn |
| U13 | Stat card trên Hôm nay chỉ để xem, không bấm được | Bấm để cuộn hoặc chuyển trang | Tránh lẫn hai kiểu hành vi |
| U14 | Chi tiêu: danh sách nhóm theo ngày thay cho `Table` | Giữ Table và đổi style | Bảng có 5 cột, hầu hết hẹp, không dùng sắp xếp; nhóm theo ngày khớp với cách người ta nhớ chi tiêu |
| U15 | Bỏ so sánh với tháng trước (▲12%) | Thêm một lần đọc tháng trước | Chưa cần; thêm khi muốn xem xu hướng |
| U16 | Thẻ ghi chú mở bằng "stretched link" (`::after` của nút tiêu đề) | Cả thẻ là một `<button>` | Không lồng phần tử tương tác (nút Sửa/Xóa, phóng ảnh) |
| U17 | Nút Sửa/Xóa hiện khi hover **hoặc** `:focus-within` | Luôn hiện; chỉ khi hover | Gọn mắt nhưng vẫn dùng được bằng bàn phím |

## Thiết kế

### 1. Nền tảng: token, font, UnoCSS

**Token** khai báo trong `styles.css`, một lần cho `:root` và một lần cho `[data-theme=dark]`:

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `canvas` | `#FAF8F5` | `#1A1714` | nền trang |
| `surface` | `#FFFFFF` | `#23201C` | thẻ, ô soạn tin |
| `sunken` | `#F3EFEA` | `#1F1C19` | sidebar, top bar |
| `line` | `#E7E1D9` | `#34302B` | viền |
| `ink` / `ink-2` | `#2B2622` / `#746A62` | `#EDE7E1` / `#A39A91` | chữ |
| `accent` | `#B5552F` | `#E08A63` | hành động chính |
| `accent-soft` | accent 10% | accent 16% | đang chọn, chip |

- Cùng khối đó gán lại token của thư viện (`--bg-1/2/3`, `--primary`, `--border-base`, `--text-primary/secondary`, `--message-user-bg`) và thang RGB của Arco (`--primary-1…10`, `--gray-1…10`, thang 10 bậc làm tay). Nhờ vậy mọi widget Arco và `@aionui/ui` (modal, picker, table...) đổi màu mà không cần CSS riêng cho từng component.
- **Font:** Be Vietnam Pro 400/500/600/700 dạng `.woff2` trong `src/renderer/assets/fonts/`, kèm file license OFL. Khai báo bằng `@font-face`, `font-family` đặt trên `body`. Nếu thiếu file thì `system-ui` thay thế.
- **UnoCSS:**
  - Thêm `unocss` vào devDependencies, ghim bản 66.x đang có.
  - Plugin `UnoCSS()` trong phần renderer của `electron.vite.config`.
  - `uno.config.ts` dùng `presetWind3`, chỉ quét `src/renderer/**/*.tsx`.
  - `theme.colors` ánh xạ các tên trong bảng trên sang `var(--…)`. Bo góc: `card` 14px, `ctl` 10px. Một `shadow-card` ấm.
- **Thứ tự CSS** trong `main.tsx`: arco.css → styles của thư viện → arco-theme → `virtual:uno.css` → `styles.css` (override của app thắng).
- Keyframe chuyển động và phần `prefers-reduced-motion` giữ nguyên.

### 2. Khung app: title bar, nav, hội thoại, phím tắt

- **Bố cục:** hai cột cao hết cửa sổ.
  - **Sidebar** (`sunken`) chạy tới mép trên. 44px trên cùng là vùng kéo cửa sổ, có tên app và nút thu gọn.
  - **Cột chính** (`canvas`) có top bar 44px (vùng kéo): tiêu đề hiện tại (tên trang hoặc tên hội thoại), `WindowControls` bên phải. Bỏ title bar ngang cũ và viền của nó.
  - Tiêu đề đã nằm trên top bar, nên các trang không còn h1 lớn. Mỗi trang bắt đầu bằng **hàng toolbar** (bộ lọc, hành động). Riêng Hôm nay mở đầu bằng lời chào.
- **Nav (`components/Nav.tsx`)** thay `SiderItem` của thư viện, chỉ trong app:
  - `<nav>` gồm các `<button>` thật (icon + nhãn): focus được, Enter/Space hoạt động.
  - Mục đang chọn: nền `accent-soft`, chữ `accent`. `focus-visible` có ring.
  - Thu gọn (Ctrl+B hoặc nút): sidebar 64px, chỉ icon, `Tooltip` của Arco hiện nhãn và phím tắt.
  - Cài đặt ghim ở đáy.
  - Đóng luôn mục "Keyboard access" trong Known gaps của plan.md cho phần nav của app.
- **Hội thoại mới:** nút dịu hơn, dạng pill `accent-soft` có gợi ý "Ctrl+N", thay cho nút xanh đậm tràn ngang.
- **Danh sách hội thoại:**
  - Nhóm theo ngày địa phương của `updated_at`: Hôm nay / Hôm qua / 7 ngày qua / Cũ hơn. Nhóm rỗng thì ẩn.
  - Mỗi mục là một button, tiêu đề cắt bớt (`title` chứa đầy đủ). Nút "⋯" hiện khi hover **và** khi focus, mở `Dropdown` của Arco: Đổi tên, Xóa.
  - **Đổi tên** ngay tại chỗ: tiêu đề thành ô nhập. Enter hoặc blur thì lưu, Escape thì hủy. Rỗng hoặc không đổi thì bỏ qua. Nhấp đúp vào mục cũng bắt đầu đổi tên. Bản nháp giữ nguyên khi danh sách refresh.
- **Main:** IPC mới `conversations:rename(id, title)`: trim, tối đa 100 ký tự, từ chối chuỗi rỗng, `UPDATE conversations SET title`. Thêm `rename` vào preload và kiểu `api`. Auto-title chỉ ghi khi title còn là mặc định (`store.ts`, `AND title = ?`), nên không đè lên tên người dùng đặt.
- **Phím tắt:** một listener `keydown` trong `App`. Bỏ qua khi đang mở modal của Arco.

  | Phím | Hành động |
  |---|---|
  | Ctrl+N | hội thoại mới |
  | Ctrl+1…5 | Hôm nay, Task, Ghi chú, Chi tiêu, Nhắc nhở |
  | Ctrl+, | Cài đặt |
  | Ctrl+B | thu gọn/mở sidebar |

- `WindowControls` giữ nguyên (aria-label tiếng Anh vẫn là known gap của thư viện).

### 3. Trang Hôm nay: dashboard

Không thêm lần đọc dữ liệu nào: dùng `get_today_overview` và `list_reminders` 7 ngày như hiện tại.

1. **Lời chào:** "Chào buổi sáng / chiều / tối" theo giờ, ngày dạng dài. Một dòng tóm tắt từ các con số, vd "3 việc hôm nay · 1 quá hạn · 2 nhắc nhở", bỏ phần bằng 0.
2. **Stat card:** 4 thẻ `StatCard` trong lưới co giãn (`repeat(auto-fit, minmax(160px, 1fr))`): Quá hạn (tông đỏ khi > 0), Việc hôm nay, Nhắc nhở hôm nay, Đã chi hôm nay (nhiều loại tiền nối bằng " + "). Mỗi thẻ có icon, số lớn, nhãn. Chỉ để xem (U13).
3. **Hành động nhanh** (pill dịu):
   - **Hỏi trợ lý:** prop mới `go('chat')` từ `App`, mở hội thoại gần nhất và focus ô soạn tin.
   - **+ Task / + Chi tiêu / + Nhắc nhở:** mở `TaskForm`, `ExpenseForm`, `ReminderForm` có sẵn ngay trên trang, không sửa form. `useData` tải lại như các trang khác.
4. **Hai thẻ cạnh nhau** (xếp chồng khi vùng nội dung hẹp hơn khoảng 1000px):
   - **Việc:** quá hạn trước (ngày màu đỏ), rồi việc hôm nay. Checkbox hoàn thành và hiệu ứng gạch ngang giữ nguyên.
   - **Nhắc nhở:** hôm nay, rồi 7 ngày tới (có ngày). Bỏ qua và xóa như hiện tại.
   - Header thẻ có số đếm. Thẻ rỗng hiện một dòng nhỏ ("Không có việc nào hôm nay") thay vì biến mất, để bố cục ổn định.
- **Cả ngày trống:** thay lưới bằng `EmptyState` "Hôm nay thảnh thơi" với CTA "+ Task" và "Hỏi trợ lý".
- **Đang tải:** skeleton cùng hình dạng stat card và danh sách, không bị nhảy khi dữ liệu về.

### 4. Task, Ghi chú, Nhắc nhở dạng thẻ

- **Mẫu danh sách dùng chung:** mỗi nhóm là một thẻ `surface` (bo góc, bóng nhẹ), tiêu đề nhóm ở trên (nhãn + số đếm). Các dòng trong thẻ ngăn bằng đường mảnh, hover đổi nền `canvas`.
  - Sửa/Xóa hiện khi hover hoặc `:focus-within` (U17). Hành động chính của dòng luôn hiện: checkbox của task, nút Bỏ qua của nhắc nhở.
  - **Chip** một kiểu, nhiều tông: ưu tiên Cao (đỏ nhạt), Thấp (trung tính); danh mục có chấm màu; lặp lại có icon; hạn (đỏ khi quá hạn).
  - **Bộ lọc:** `Radio.Group type='button'` của Arco được style lại một lần trong `styles.css` thành segmented control (rãnh `sunken`, lựa chọn là pill `surface`). Mọi trang dùng chung.
  - **Empty state:** component `EmptyState` (icon trong vòng tròn dịu, tiêu đề, gợi ý, CTA tùy chọn) thay `Empty` của Arco ở mọi nơi, căn giữa theo chiều dọc. CTA là "+ Thêm…" hoặc "Hỏi trợ lý".
- **Task:** giữ các nhóm Quá hạn / Hôm nay / Sắp tới / Không hạn, mỗi nhóm một thẻ. Chế độ đã đóng hoặc tất cả là một thẻ phẳng. Checkbox tròn, tô màu nhấn khi tick. Giữ hiệu ứng gạch ngang và mờ khi xong.
- **Ghi chú:** **lưới thẻ** (`auto-fill, minmax(240px, 1fr)`). Mỗi thẻ: nhãn nhật ký, tiêu đề (hoặc "Không tiêu đề"), đoạn trích tối đa 4 dòng có highlight tìm kiếm, ảnh nhỏ, ngày ở chân thẻ. Bấm vào thẻ để mở ghi chú (U16); nút Sửa/Xóa và phóng ảnh nằm trên lớp phủ. Ô tìm kiếm rộng hết toolbar.
- **Nhắc nhở:** tiêu đề ngày thân thiện: "Hôm nay", "Ngày mai", rồi "Thứ Năm, 2/10" (có bản tiếng Anh). Mỗi dòng bắt đầu bằng pill giờ (số tabular). Chip trạng thái chỉ hiện ở chế độ "Tất cả". Nút Bỏ qua luôn hiện với nhắc nhở đang chờ; Sửa/Xóa hiện khi hover.
- Trang Hôm nay dùng cùng kiểu dòng.

### 5. Chi tiêu: tổng quan trực quan

Không thêm lần đọc dữ liệu: dùng `list_expenses` của tháng (các khoản và tổng theo loại tiền) như hiện tại.

- **Toolbar:** "‹ Tháng 9, 2026 ›": nút mũi tên lùi/tiến một tháng, bấm vào nhãn mở `MonthPicker` có sẵn. "+ Thêm" bên phải.
- **Thẻ tổng quan:**
  - **Tổng tháng** cỡ lớn, số tabular. Nhiều loại tiền: tổng lớn nhất đứng đầu, còn lại nhỏ hơn ("+ 20 USD").
  - **Theo danh mục:** thanh ngang xếp chồng, mỗi loại tiền có chi một thanh (thường chỉ một). Đoạn xếp theo số tiền. 6 danh mục lớn nhất có màu từ bảng màu ấm, phần còn lại gộp thành "Khác" màu xám.
  - **Chú thích:** mỗi danh mục một dòng: chấm màu, tên, số tiền, phần trăm. Thanh là `aria-hidden`, chú thích là bản đọc được. Bảng màu làm theo skill `dataviz` và được kiểm tra ở cả hai theme.
  - Bấm một dòng chú thích thì **lọc** danh sách bên dưới theo danh mục đó, có chip "✕ bỏ lọc". Lọc phía client; bấm lại để bỏ.
- **Danh sách:** thay `Table` của Arco bằng mẫu thẻ như các trang khác, **nhóm theo ngày** (U14):
  - Tiêu đề ngày: "Thứ Tư, 30/9", tổng của ngày bên phải.
  - Dòng: chip danh mục, mô tả (bấm để sửa), ảnh nhỏ, số tiền căn phải (số tabular). Sửa/Xóa hiện khi hover hoặc focus.
- **Tháng trống:** `EmptyState` "Chưa có khoản chi tháng này" với CTA "+ Thêm" và "Hỏi trợ lý" (vd chụp hóa đơn gửi trợ lý).
- Không làm so sánh với tháng trước (U15).

### 6. Chat và Cài đặt

- **Chat:**
  - Bong bóng người dùng: nền `accent-soft`, chữ `ink`, thay cho xanh đậm.
  - Câu trả lời của trợ lý vẫn là Markdown không khung. Cột tin nhắn hẹp lại còn 760px cho dễ đọc.
  - **Hội thoại trống:** căn giữa theo chiều dọc, lời chào 26px, gợi ý thành lưới 3 cột, mỗi thẻ có icon.
  - **Ô soạn tin:** thẻ `surface` bo 18px. Nút Gửi tròn, chỉ icon, màu nhấn (giữ `aria-label`). Nút Ảnh chỉ icon, có tooltip. Placeholder rút gọn thành "Nhắn cho trợ lý…"; gợi ý phím chuyển thành một dòng nhỏ dưới ô soạn: "Enter gửi · Shift+Enter xuống dòng · / lệnh nhanh".
  - **Thẻ xác nhận:** giữ viền màu theo trạng thái, thêm icon của tool ở header. Nút Xác nhận (primary) và Hủy (text).
  - `ThoughtDisplay` chỉ đổi qua token.
- **Cài đặt, form, modal:** không đổi markup. Token đổi giao diện (modal bo 16px, bề mặt ấm). Kiểm tra lại hack tương phản ô nhập trong Cài đặt với bề mặt mới; xóa nếu không còn cần.

### 7. Trường hợp biên

- Tiêu đề dài: cắt bớt, `title` chứa đầy đủ.
- Nhãn tiếng Việt dài hơn tiếng Anh: nhãn nav có ellipsis. Kiểm tra mọi bố cục ở chiều rộng tối thiểu của cửa sổ (800px, vùng nội dung khoảng 560px khi sidebar mở).
- Đổi tên khi auto-title về: xem mục 2 (main chỉ ghi khi title còn mặc định).
- `localStorage` bọc trong try/catch.
- Font không tải được: `system-ui` thay thế.

### 8. Kiểm thử

- Test hiện có, `typecheck` và `build` vẫn xanh.
- Test mới: đổi tên hội thoại (trim, tối đa 100 ký tự, từ chối chuỗi rỗng).
- **Kiểm tra bằng mắt:** chụp mọi trang qua hook screenshot, **sáng và tối**, từ một profile tạm có dữ liệu mẫu (task, ghi chú, chi tiêu từ 5 danh mục trở lên, nhắc nhở). Không dùng dữ liệu thật của người dùng.
- Kiểm tra bàn phím thủ công: nav, đổi tên, nút hiện khi hover, phím tắt.
- Thêm các bước mới vào `docs/smoke-test.md`.

### 9. Triển khai

Mỗi giai đoạn một commit, kết thúc bằng test xanh và ảnh chụp màn hình:

1. Nền tảng: UnoCSS, token, font, override Arco và thư viện.
2. Khung app: bố cục, `Nav`, hội thoại, IPC rename, phím tắt.
3. Phần dùng chung: `EmptyState`, `StatCard`, mẫu thẻ danh sách, chip, segmented control.
4. Hôm nay.
5. Task, Ghi chú, Nhắc nhở.
6. Chi tiêu.
7. Chat và Cài đặt.
8. Tài liệu: phần "As built" của thiết kế và smoke test.

## As built

Commit `7fe60e1` → `4ef0bc6` (sau `f9c52db`). Code là bản tham chiếu; mục này ghi những chỗ khác thiết kế.

- **Main:**
  - IPC tên là `conv:rename` (theo các kênh `conv:*` có sẵn), không phải `conversations:rename`. Chuỗi dài hơn `MAX_TEXT` (20.000) bị từ chối trước khi xử lý. Store chuẩn hóa NFC, gộp khoảng trắng, cắt còn 100 ký tự; không đổi `updated_at` nên đổi tên không làm nhảy thứ tự.
  - `dayBucket` (`shared/dates.ts`) coi thời điểm ở tương lai là "Hôm nay" (`today` cũ sau nửa đêm, lệch đồng hồ).
- **Nền tảng:**
  - Token khai báo trên `body` và `body[arco-theme='dark']` (không phải `:root` / `[data-theme=dark]`), để thắng biến của Arco và của thư viện.
  - `arco-theme.css` của `@aionui/ui` đặt `html { font-size: var(--app-font-size, 14px) }`, nên rem = 14px. `uno.config.ts` có `postprocess` đổi rem thành px theo gốc 16px. Thư viện có utility cùng tên trong CSS của nó; bản px của app nạp sau nên thắng trong toàn app.
  - Token thêm: `--pill` (chip, số đếm; tối = `line` vì `sunken` không thấy trên `surface` tối), `--on-accent` (chữ trên nền accent; tối là `#1a1714` vì chữ trắng trên `#e08a63` chỉ ~2.5:1), `--hover`, `--link-1…6` (link của Arco, vd "hôm nay" trong date picker, mặc định xanh), `--aou-2` / `--aou-7` (highlight menu `/`), `--bg-4` (viền ô nhập khi hover trong modal, mặc định `#c9cdd4` xám lạnh), `--bg-6` (chữ phụ), `--cat-*` (màu danh mục chi tiêu).
  - Sáng: `--ink-2` `#746a62`. Accent `#ab502d` thay `#b5552f` (U6): chữ accent trên nền `accent-soft` trên `surface` chỉ đạt 4.28:1; `#ab502d` đạt 4.69:1, chữ trắng trên accent 5.36:1. `--primary-5/6/7` của Arco đổi theo. `--cat-1` giữ `#b5552f`.
  - Segmented control: ở theme tối, pill đang chọn dùng `--line` (surface gần như trùng rãnh `sunken`).
  - Nút primary bị disable: chữ `ink-2` (Arco để chữ trắng trên nền `--aou-2` nhạt).
  - Ô nhập, textarea, select, picker của Arco có viền `--line` khi nghỉ và khi hover ở mọi nơi (cùng selector thư viện dùng trong modal); focus, lỗi, cảnh báo, disable giữ màu của Arco. Ô soạn tin vẫn không viền.
  - `.page` có `scrollbar-gutter: stable`: mép phải giống nhau dù trang có cuộn hay không.
- **Toolbar các trang:** Task bỏ dòng gợi ý. Ghi chú bỏ gợi ý, ô tìm kiếm nằm trong toolbar (placeholder tiếng Việt ghi "không cần gõ dấu"). Cài đặt không có toolbar. Hôm nay dùng lời chào thay cho gợi ý.
- **Hôm nay:**
  - Lưới stat card `minmax(200px, 1fr)` (không phải 160px).
  - Ngày trống hoàn toàn thì ẩn hàng hành động nhanh; `EmptyState` có "+ Thêm task" và "Hỏi trợ lý".
  - Số tiền đã chi nằm trong dòng tóm tắt.
  - Nút thêm dùng lại key tiêu đề form (`addTask`, `addExpense`, `addReminder`).
- **Ghi chú:** nút Sửa/Xóa đặt `absolute` nhưng nằm sau đoạn trích trong DOM (thứ tự Tab). Chỉ nút ảnh nhỏ nằm trên lớp phủ stretched link.
- **Chi tiêu:**
  - Bảng màu (skill `dataviz`), theo hạng: sáng `#b5552f #099fb1 #a05377 #c4a032 #728ad1 #33936a`, Khác `#b8afa6`; tối `#cf704c #099fb2 #a05377 #ac8909 #728ad1 #29a674`, Khác `#7a7068`. Validator: sáng ΔE CVD kề nhau 10.3, thường 18.4; tối 10.4 / 19.5, mọi màu ≥ 3:1. Sáng `#c4a032` chỉ 2.5:1 trên nền trắng; chú thích (số tiền, phần trăm) là bản đọc được.
  - Một danh mục giữ một màu trên mọi thanh loại tiền (bảng slot theo hạng của thanh đầu; danh mục không có ở đó lấy slot trống thấp nhất của thanh mình).
  - Lưới chú thích `minmax(240px, 1fr)`. Tên tháng từ `common.monthLong`.
  - Tháng trống chỉ có "+ Thêm" (không có "Hỏi trợ lý").
- **Chat:**
  - Ô soạn, dòng gợi ý phím và menu `/` căn theo cột 760px.
  - Menu `/` bị mất blur: animation có fill-mode biến nó thành backdrop root; đã bỏ fill-mode.
  - Tag "Chờ xác nhận" dùng accent. Nút Hủy của thẻ xác nhận là kiểu text.
  - Nhãn `attachImage` đổi thành "Đính kèm ảnh" / "Attach image".
  - Thẻ xác nhận và ô soạn dùng `--shadow-card` (bóng theo `--gray-10` thành quầng sáng ở theme tối).
- **Cài đặt:** hàng `PreferenceRow` xuống dòng khi hẹp (ô điều khiển rộng cố định 380px nằm dưới nhãn), không tràn ngang ở 800px.
- **Bàn phím:**
  - Mở menu "⋯" của hội thoại thì focus vào mục đầu của menu (popup nằm ở `body`, không thì không Tab tới được).
  - Chọn Xóa (hoặc Đổi tên) bằng Enter trong menu có `preventDefault`: Arco xử lý ở keydown, nếu không thì Enter kích hoạt tiếp phần tử nhận focus sau đó (vd nút của hộp xác nhận xóa).
  - Phím tắt bỏ qua phím lặp khi giữ (`e.repeat`).
- **Giới hạn đã biết:**
  - Task vừa tick không kịp hiện gạch ngang: `data:changed` tải lại ngay (có từ trước).
  - Hủy hộp xác nhận xóa thì focus về `body` (hành vi của Arco).
  - Ngày vẫn dạng dd/mm/yyyy ở tiếng Anh (quyết định chung của app).
  - Đổi tháng ở Chi tiêu thoáng hiện dữ liệu tháng trước (`useData` chỉ hiện loading ở lần đọc đầu).
  - Mục đang chọn trong sidebar (chữ accent trên `accent-soft` trên nền `sunken`) đạt 4.11:1, dưới AA cho chữ thường. Đạt 4.5:1 cần accent khoảng `#9f4a2a` hoặc đổi nền mục chọn; chưa làm.
  - Viền `--line` của ô nhập chỉ đậm hơn nền ô một chút (sáng `#e7e1d9` trên fill `#f1ede8`).
