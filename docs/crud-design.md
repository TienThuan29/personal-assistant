# CRUD thủ công: Task, Ghi chú, Chi tiêu, Nhắc nhở

Ngày: 2026-09-28 · Trạng thái: đã duyệt

## Tóm tắt

- Thêm **Tạo** và **Sửa** thủ công cho Task, Ghi chú, Chi tiêu, cùng một **trang Nhắc nhở** mới. Xem và Xóa đã có sẵn.
- Mục đích: quản lý dữ liệu trực tiếp, không bắt buộc phải qua chatbot.
- Mỗi trang có nút **+ Thêm** trên header và nút **Sửa** trên từng dòng. Cả hai mở một modal, dùng chung một form cho thêm và sửa.
- Form **thêm được ảnh** (chọn, dán, kéo thả như SendBox) và **gỡ được ảnh** đã đính kèm.
- Trang Task có bộ lọc trạng thái. Form sửa có trường Trạng thái để mở lại task.
- **Không làm:** thay đổi chatbot (prompt, tool, schema giữ nguyên), sửa trên trang Hôm nay, tính năng ngoài CRUD.

## Giả định

1. Form gọi **tool sẵn có** (`create_*`, `update_*`), nên validation, chuẩn hóa category, sinh lần lặp kế tiếp, kiểm tra "nhắc nhở ở tương lai" dùng chung với bot. Ghi thủ công không cần thẻ xác nhận, vì bấm Lưu đã là xác nhận (D7). Xóa vẫn hỏi lại.
2. Nhắc nhở chỉ sửa nội dung và thời điểm, không gắn task bằng tay. Liên kết task đang có được giữ nguyên.
3. Quy mô cá nhân, vài nghìn bản ghi. Giữ nguyên giới hạn danh sách hiện có (task 200, ghi chú 100, nhắc nhở 200).
4. Ảnh: PNG/JPEG, tối đa 10 ảnh mỗi lần lưu, kiểm tra như ảnh chat (`toJpeg`).
5. Mọi chữ mới có đủ vi và en.

## Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| C1 | Form thêm/sửa có quản lý ảnh (thêm và gỡ) | Chỉ xem ảnh cũ; bỏ hẳn ảnh | Người dùng chọn |
| C2 | Có cả Nhắc nhở | Chỉ Task, Ghi chú, Chi tiêu | Người dùng chọn |
| C3 | Nhắc nhở có trang riêng trên sidebar | Trên trang Hôm nay; một tab trong trang Task | Trang Hôm nay chỉ hiện vài ngày tới |
| C4 | Form dạng modal (AionModal) | Drawer; sửa trực tiếp trên dòng | Giống modal xem ghi chú đang có, hợp với ghi chú dài và ảnh |
| C5 | Trang Task có bộ lọc trạng thái, form sửa có trường Trạng thái | Chỉ hiện task chưa xong | Trước đây task đã xong hoặc đã hủy biến mất khỏi UI |
| C6 | **Hướng A**: tool sẵn có + một IPC `data:save` lưu kèm ảnh trong một transaction | B: upload ảnh trước rồi truyền id (đổi schema tool của bot, sinh ảnh nháp khi hủy form); C: IPC CRUD riêng cho từng loại (trùng validation) | Không đổi tool của bot, không sinh ảnh rác, validation một chỗ |
| C7 | Form chỉ gửi **các trường đã đổi** (`diffPatch`) | Gửi cả form | Tránh tác dụng phụ, vd sửa chữ của nhắc nhở đã qua giờ mà gửi lại `remind_at` cũ thì bị `reminderPast` |
| C8 | Commit 11 file UI polish của người dùng trước khi làm (`36145a4`) | Để nguyên và stage riêng | Cùng file, tránh trộn thay đổi |

## Thiết kế

### 1. Main process: IPC `data:save(tool, args, images, removeIds)`

- **Allowlist**: `create_task`, `update_tasks`, `create_note`, `update_notes`, `create_expense`, `update_expenses`, `create_reminder`, `update_reminders`. Tên khác bị từ chối (`errors:notAllowed`). Với `update_*`, `ids` phải có **đúng một** id.
- **Kiểm tra hết trước khi ghi**:
  - `args` qua `parseArgs` bằng zod schema của tool, như `data:write`.
  - Mỗi ảnh qua `toJpeg`. Tối đa `MAX_IMAGES` ảnh.
  - Nhắc nhở không nhận ảnh.
- **Trong một `tx`**:
  1. Chạy tool. Owner id lấy từ row vừa tạo (`create`) hoặc `ids[0]` (`update`).
  2. Lưu ảnh mới bằng `saveAttachment` với owner là bản ghi (`task` / `note` / `expense`).
  3. Xóa các row attachment trong `removeIds`, **chỉ khi thuộc đúng bản ghi đó** (khớp `owner_type` + `owner_id`). Id không khớp thì bỏ qua. File được `cleanupOrphans` dọn lúc khởi động.
  4. Gọi `onDataChanged()` và trả về row đã lưu.
- **Patch rỗng**: nếu chỉ đổi ảnh, không gọi tool, chỉ kiểm tra bản ghi tồn tại (`requireRows`).
- **Giữ nguyên**: `data:write` (xóa, hoàn thành, bỏ qua nhắc nhở), mọi tool của bot, prompt.
- Nếu ảnh lưu lỗi giữa chừng, transaction rollback nên không có row nào trỏ tới ảnh thiếu. File đã ghi thành file mồ côi và được dọn lúc khởi động, như `chat:send`.

### 2. UI dùng chung

- **`useImagePicker`**: tách logic chọn, dán, kéo thả ảnh từ SendBox (PNG/JPEG, giới hạn dung lượng, tối đa 10). SendBox cũng dùng hook này.
- **`ImageField`**:
  - Hiện ảnh đã có (từ `attachment_ids`, có ✕ để đánh dấu gỡ; chỉ gỡ thật khi Lưu) và ảnh mới (`FilePreview`, có ✕).
  - Trả `{ images, removeIds }`.
- **`RecordModal`**:
  - Bọc `AionModal` + Arco `Form`, tiêu đề "Thêm …" / "Sửa …", footer **Hủy / Lưu**.
  - Kiểm tra trường bắt buộc ở client, còn main là chuẩn: lỗi từ main hiện bằng `Alert` **trong modal**, modal giữ nguyên dữ liệu đã nhập.
  - Lưu thì khóa nút, thành công thì đóng. Danh sách tự tải lại qua `data:changed`.
  - Đóng khi còn thay đổi chưa lưu thì hỏi "Bỏ thay đổi?".
  - `Ctrl+Enter` để lưu; Enter trong ô một dòng không submit.
- **`diffPatch(before, values)`** (thuần, trong `shared/`): trả các trường đã đổi, chuỗi rỗng thành `null` với trường xóa được.
- **`api.data.save`** trong preload và kiểu `Api`.
- Mỗi trang: nút **+ Thêm** trong `SettingsPageHeader.actions`. Mỗi dòng có icon **Sửa** (`Edit`) cạnh Xóa, bấm vào chữ chính của dòng cũng mở Sửa.

### 3. Form từng loại

- **Task**:
  - Trường:
    - Tiêu đề (bắt buộc)
    - Ghi chú
    - Phân loại: Công việc / Cá nhân, hoặc tự nhập (`Select allowCreate`)
    - Ưu tiên: Cao / Thường / Thấp
    - Ngày hạn (dd/mm/yyyy) và giờ hạn (HH:mm), đều xóa được
    - Lặp lại: Không / Hàng ngày / Hàng tuần (chọn T2…CN) / Hàng tháng (ngày 1–31), ánh xạ sang `daily`, `weekly:1,3`, `monthly:15`
    - Trạng thái (chỉ khi sửa). Đổi task lặp sang Đã xong / Đã hủy thì sinh lần kế tiếp, theo logic có sẵn.
    - Ảnh
  - Trang có thêm bộ lọc **Chưa xong / Đã xong / Đã hủy / Tất cả** (`list_tasks.status`). Task đã xong hoặc đã hủy hiện mờ.
- **Ghi chú**:
  - Trường:
    - Loại: Ghi chú / Nhật ký
    - Tiêu đề (tùy chọn)
    - Nội dung (bắt buộc, TextArea tự giãn)
    - Ảnh
  - Bấm vào ghi chú mở **form sửa** (thay modal chỉ xem). Nội dung đầy đủ lấy bằng `get_notes`.
- **Chi tiêu**:
  - Trường:
    - Số tiền (`InputNumber`, nhập theo đơn vị chính, vd 12.50 USD). App quy đổi sang đơn vị nhỏ nhất lúc lưu và ngược lại lúc mở, bằng `minorDigits(currency)` mới trong `shared/money.ts`; `formatMoney` cũng dùng hàm này.
    - Tiền tệ (3 chữ, mặc định theo Cài đặt)
    - Danh mục (bắt buộc, `AutoComplete` gợi ý các danh mục đang có trên trang)
    - Mô tả
    - Ngày chi (mặc định hôm nay)
    - Ảnh
  - Bảng có cột Sửa cạnh Xóa.
- **Nhắc nhở** (trang mới, route `reminders`, icon `Remind`, đứng sau Chi tiêu):
  - Bộ lọc: **Sắp tới / Đã nhắc / Đã bỏ qua / Tất cả** (`list_reminders.status`).
  - Danh sách nhóm theo ngày, hiện giờ và task liên quan (nếu có).
  - Dòng có Sửa, Bỏ qua (chỉ với nhắc chưa tới giờ) và Xóa.
  - Form: Nội dung (bắt buộc), Thời điểm (`DatePicker showTime` dd/mm/yyyy HH:mm, không cho chọn quá khứ; main cũng kiểm tra). Dời giờ nhắc nhở đã nhắc hoặc đã bỏ qua thì nó nhắc lại, theo logic có sẵn.
- **Trang Hôm nay**: không đổi.

## Yêu cầu phi chức năng

- **Hiệu năng**: mỗi lần lưu là một transaction SQLite cục bộ. UI cập nhật ngay nhờ `data:changed`.
- **Bảo mật**:
  - Renderer chỉ gọi được tool trong allowlist, tham số qua zod.
  - Ảnh qua `toJpeg`. Ảnh cần gỡ phải thuộc đúng bản ghi.
  - Không lộ SQL ghi.
- **Tin cậy**: lưu lỗi thì rollback toàn bộ (bản ghi + ảnh), form giữ dữ liệu, lỗi hiện trong modal.
- **Bảo trì**: validation ở một chỗ (tool). UI dùng chung `RecordModal`, `ImageField`, `diffPatch`.

## Rủi ro

- **Quy đổi đơn vị tiền**: sai số chữ số thập phân làm lệch 100 lần. Có unit test cho `minorDigits` và vòng quy đổi (VND, USD, JPY).
- **Múi giờ của nhắc nhở**: form gửi giờ máy dạng `YYYY-MM-DDTHH:mm`, main chuyển sang UTC bằng `toInstant` như với bot.
- **Hai nơi cùng sửa** (chatbot có thẻ chờ xác nhận trên bản ghi đang mở trong form): lần lưu sau thắng. Chấp nhận được với một người dùng.
- **Danh sách nhắc nhở tối đa 200 dòng**: đủ cho dùng cá nhân. Ghi chú `ponytail:` trong code.

## Kiểm thử

- **`data:save`**:
  - tạo kèm ảnh
  - sửa có thêm và gỡ ảnh
  - `removeIds` của bản ghi khác bị bỏ qua
  - tool ngoài allowlist bị từ chối
  - `ids` > 1 bị từ chối
  - ảnh hỏng thì không ghi gì
  - chỉ đổi ảnh
  - nhắc nhở kèm ảnh bị từ chối
- **Hàm thuần**: `diffPatch`, `minorDigits` / quy đổi tiền, ánh xạ lặp lại ↔ chuỗi `recurrence`.
- **Locale**: test vi/en đủ key.
- **Chụp màn hình** bằng hook dev (`PA_PAGE=tasks|notes|expenses|reminders`) với thư mục userData tạm.
