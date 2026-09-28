# Kế hoạch: CRUD thủ công

Thiết kế: `docs/crud-design.md` (C1–C8). Mỗi task: implementer → review spec → review chất lượng → commit.

## Quy ước chung

- Chạy lệnh ở `personal-assistant/`:
  - `bun run typecheck`
  - `bun run test` (vitest trên Node của Electron; bỏ qua dòng "Timeout terminating forks worker")
- Code và comment tiếng Anh, giống văn phong hiện có. Chuỗi UI đi qua i18next: key mới thêm vào **cả** `src/shared/locales/vi.ts` và `en.ts` (có test kiểm tra đủ key).
- node:sqlite ném lỗi khi bind `undefined`: luôn `?? null`.
- Không đổi schema hay mô tả của tool bot, không đổi `src/main/prompt.ts`.
- Commit message dạng `feat(...)`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Không động vào dữ liệu thật ở `%APPDATA%/personal-assistant`. Chụp màn hình bằng hook dev với userData tạm.

## Task 1: Main `saveRecord` + IPC `data:save` + hàm thuần dùng chung

**File:**
- mới: `src/main/save.ts`, `src/shared/patch.ts`, `tests/save.test.ts`, `tests/patch.test.ts`
- sửa: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/shared/money.ts`, `src/shared/dates.ts`, `src/main/errors.ts` (nếu cần key mới), locales

1. `src/main/save.ts`: `saveRecord(ctx: ToolCtx & { attachmentsDir: string }, tool: string, args: unknown, jpegs: Buffer[], removeIds: unknown): unknown`
   - `SAVE_TOOLS`: map tên tool sang owner:
     - `create_task` / `update_tasks` → `task` / `tasks`
     - `create_note` / `update_notes` → `note` / `notes`
     - `create_expense` / `update_expenses` → `expense` / `expenses`
     - `create_reminder` / `update_reminders` → owner `null` / `reminders`
   - Tên không có trong map → `UserError('notAllowed', { name })`.
   - `removeIds` phải là mảng chuỗi (khác → `invalidValue`).
   - Owner `null` mà có ảnh hoặc `removeIds` → `invalidValue`.
   - Với `update_*`:
     - `args.ids` phải đúng 1 phần tử, khác → `UserError('saveOneRecord')`, key mới vi/en.
     - Nếu `args.patch` là object rỗng (`{}`): không gọi tool, chỉ `requireRows(table, ids)`.
     - Ngược lại: `parseArgs` rồi `tool.apply`.
   - Với `create_*`: `parseArgs` rồi `apply`; owner id = `result.id`.
   - Tất cả nằm trong một `tx(db, …)`:
     - Ảnh mới: `saveAttachment({ id: newAttachmentId(), bytes, mime: 'image/jpeg', ownerType, ownerId })`.
     - Gỡ ảnh: `DELETE FROM attachments WHERE id = ? AND owner_type = ? AND owner_id = ?`.
     - Trả về row sau khi lưu (`getRows(table, [ownerId])[0]`).
2. `ipc.ts`: `ipcMain.handle('data:save', (_e, name, args, images, removeIds))`.
   - Kiểm tra `images` là mảng, dài ≤ `MAX_IMAGES`.
   - `jpegs = images.map(img => toJpeg(img?.bytes))` trước khi ghi.
   - Gọi `saveRecord({ ...ctx, attachmentsDir }, …)`, rồi `m.onDataChanged()`.
   - `UI_WRITES` giữ nguyên.
3. Preload + `Api.data.save(tool: string, args: object, images?: ImageInput[], removeIds?: string[]): Promise<unknown>`.
4. `src/shared/patch.ts`: `diffPatch(before: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown>`
   - Chỉ giữ key có giá trị khác `before[key]`, so bằng `===` sau khi chuẩn hóa `''`/`undefined` → `null`.
   - Trả ra `null` cho trường bị xóa.
5. `src/shared/money.ts`:
   - `minorDigits(currency)`: số chữ số thập phân theo `Intl`, lỗi → 0.
   - `toMinor(major, currency)`: `Math.round(major * 10 ** d)`.
   - `fromMinor(minor, currency)`.
   - `formatMoney` dùng `minorDigits`.
6. `src/shared/dates.ts`: `RecurrenceForm = { kind: 'none'|'daily'|'weekly'|'monthly'; weekdays: number[]; day: number }`, cùng `parseRecurrence(s: string|null): RecurrenceForm` và `formatRecurrence(f): string|null`. Weekly không chọn ngày nào → `null`.
7. **Test:**
   - `tests/save.test.ts` (dùng `testCtx` + `tempDir()` làm attachmentsDir, `Buffer.from('x')` làm jpeg vì saveRecord không kiểm tra ảnh):
     - tạo task kèm 2 ảnh, owner đúng
     - sửa note: thêm 1 ảnh, gỡ 1 ảnh
     - gỡ id của bản ghi khác thì không có tác dụng
     - `delete_tasks` và `list_tasks` bị `notAllowed`
     - `ids: [1, 2]` bị từ chối
     - patch rỗng + ảnh thì chỉ thêm ảnh; patch rỗng cho id không tồn tại thì `notFound`
     - lỗi giữa chừng (vd `update_tasks` với id không tồn tại kèm ảnh) thì không còn row attachment nào
     - reminder kèm ảnh thì `invalidValue`
     - sửa chỉ `message` của reminder đã qua giờ thì thành công
   - `tests/patch.test.ts`:
     - `diffPatch`
     - `toMinor` / `fromMinor` (VND 55000 ↔ 55000, USD 12.5 ↔ 1250, JPY)
     - `parseRecurrence` / `formatRecurrence` hai chiều

## Task 2: Thành phần UI dùng chung

**File:**
- mới: `src/renderer/components/useImagePicker.ts`, `ImageField.tsx`, `RecordModal.tsx`
- sửa: `src/renderer/chat/SendBox.tsx`, `styles.css`, locales

1. `useImagePicker()`:
   - Tách từ SendBox:
     - `ACCEPT`, `MAX_BYTES`, `MAX_IMAGES`
     - `addFiles` (cảnh báo bằng message)
     - `removeImage`
     - revoke object URL khi gỡ và khi unmount
   - Trả `{ images: Picked[], addFiles, removeImage, clear, toInputs(): Promise<ImageInput[]>, holder }`.
   - SendBox dùng hook, hành vi giữ nguyên (dán, kéo thả, nút chọn ảnh, giữ ảnh chọn trong lúc gửi).
2. `ImageField({ existing: string[], removed: string[], onToggleRemove(id), picker })`:
   - Ảnh đã có hiện thumbnail (`attUrl`) có nút ✕ (bấm lại để hoàn tác, ảnh bị đánh dấu thì mờ).
   - Ảnh mới hiện `FilePreview` có ✕.
   - Nút "Thêm ảnh" (input file ẩn). Vùng field nhận dán và kéo thả.
3. `RecordModal({ title, visible, dirty, saving, error, onSave, onClose, children })`:
   - `AionModal` với footer Hủy / Lưu (Lưu `loading={saving}`).
   - `error` hiện `Alert type='error'` ở đầu body.
   - Đóng khi `dirty` thì `Modal.confirm` "Bỏ thay đổi?".
   - `Ctrl+Enter` gọi `onSave`.
4. Key i18n mới (namespace `pages` hoặc `common`):
   - `add`, `edit`, `save`, `cancel`, `discardChanges`, `discard`, `addImage`, `removeImage`, `undoRemove`
   - Tiêu đề: `addTask`, `editTask`, `addNote`, `editNote`, `addExpense`, `editExpense`, `addReminder`, `editReminder`
5. Không có test tự động riêng (UI). Kiểm tra bằng typecheck và chụp màn hình SendBox không đổi.

## Task 3: Trang Task

- Bộ lọc trạng thái `Radio.Group` **Chưa xong / Đã xong / Đã hủy / Tất cả** (`todo|done|cancelled|all`), truyền `status` cho `list_tasks`.
  - Khi không phải `todo`: không nhóm quá hạn/hôm nay; hiện một danh sách phẳng.
  - Task `done`/`cancelled` có class `is-closed` (mờ), checkbox đã tick và bị khóa.
  - Muốn mở lại: dùng form sửa.
- Nút **+ Thêm** trên header. Icon `Edit` trên từng dòng. Bấm vào tiêu đề cũng mở form sửa.
- `TaskForm` (trong `pages/TasksPage.tsx` hoặc `pages/forms/TaskForm.tsx`), với các trường:
  - title (bắt buộc)
  - notes
  - category (`Select allowCreate`: work/personal + category của các task đang tải)
  - priority
  - due_date (`DatePicker` dd/mm/yyyy, value `YYYY-MM-DD`)
  - due_time (`TimePicker` HH:mm)
  - recurrence (Select Không/Hàng ngày/Hàng tuần/Hàng tháng; tuần hiện `Checkbox.Group` T2…CN; tháng hiện `InputNumber` 1–31), dùng `parseRecurrence` / `formatRecurrence`
  - status (chỉ khi sửa)
  - ImageField
- **Lưu:**
  - Thêm: `api.data.save('create_task', values bỏ trường rỗng, images)`.
  - Sửa: `api.data.save('update_tasks', { ids: [id], patch: diffPatch(before, values) }, images, removeIds)`.
  - Không có gì đổi (patch rỗng, không ảnh) thì chỉ đóng.
- Sửa `tasksHint` (vi/en): bỏ câu "Muốn thêm hoặc sửa, hãy nhắn cho trợ lý".

## Task 4: Trang Ghi chú + Chi tiêu

- **Ghi chú:**
  - Nút + Thêm.
  - Bấm vào dòng mở form sửa, thay modal xem cũ; lấy `body` đầy đủ bằng `get_notes`.
  - Icon Edit trên dòng.
  - `NoteForm`: kind (Ghi chú/Nhật ký), title, body (TextArea `autoSize={{ minRows: 8 }}`, bắt buộc), ImageField.
  - Sửa `notesHint`.
- **Chi tiêu:**
  - Nút + Thêm, cột Sửa cạnh Xóa.
  - `ExpenseForm`:
    - amount (`InputNumber` theo đơn vị chính, `precision = minorDigits(currency)`, > 0; lưu bằng `toMinor`)
    - currency (Input 3 chữ, mặc định `useUiSettings().defaultCurrency`)
    - category (`AutoComplete` từ các danh mục đang có, bắt buộc)
    - description
    - spent_at (`DatePicker`, mặc định hôm nay)
    - ImageField
  - Khi sửa, `amount` so sánh ở đơn vị nhỏ nhất.

## Task 5: Trang Nhắc nhở + điều hướng

- `Page` thêm `'reminders'`. NAV thêm `{ page: 'reminders', icon: <Remind /> }` sau expenses. Key `common:nav.reminders`.
- `RemindersPage`:
  - Bộ lọc **Sắp tới / Đã nhắc / Đã bỏ qua / Tất cả**, dùng `list_reminders` `{ status }`.
  - Nhóm theo ngày địa phương (dd/mm/yyyy), hiện giờ HH:mm và nội dung.
  - Nút Sửa, Bỏ qua (chỉ `pending`, `update_reminders` status dismissed qua `write`), Xóa (`remove`).
  - `// ponytail:` list_reminders tối đa 200 dòng; cần phân trang nếu vượt.
- `ReminderForm`:
  - message (bắt buộc)
  - remind_at (`DatePicker showTime format='DD/MM/YYYY HH:mm'`, `disabledDate` trước hôm nay; gửi `YYYY-MM-DDTHH:mm` giờ máy)
  - Không có ảnh (không truyền images).
- `PA_PAGE=reminders` chạy được với hook chụp màn hình (đã gửi `nav` với chuỗi bất kỳ; App cần nhận `reminders`).

## Task 6: Hoàn thiện

- Review toàn bộ thay đổi (một reviewer).
- Chụp màn hình từng trang và form bằng userData tạm có dữ liệu mẫu.
- Cập nhật `docs/crud-design.md` mục "As built", `docs/smoke-test.md` thêm các bước CRUD thủ công, memory.
