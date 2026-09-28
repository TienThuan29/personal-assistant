# Smoke test (run before each release)

Setup: packaged exe (`bun run pack` → `release/PersonalAssistant-portable.exe`), real LLM configured.
The packaged app shares its data folder with `bun run dev`: `%APPDATA%/personal-assistant/`
(`assistant.db`, `attachments/`, `backups/`, `secrets.bin`). Rename it first for a truly fresh start.

**Start and settings**
- [ ] Fresh start: window "Trợ lý cá nhân" opens, `backups/` has `assistant-<today>.db`.
- [ ] No LLM configured → sending a message says to open Cài đặt.
- [ ] Settings: `http://…` endpoint → "Endpoint phải dùng https"; a non-URL → "Endpoint chưa đúng dạng URL". Saving a valid config works.
- [ ] Settings: the key is never shown back ("Đã lưu (mã hóa bằng Windows)…"); `secrets.bin` has no readable key.

**Chat**
- [ ] "Hôm nay tôi có việc gì?" (or the "Tóm tắt hôm nay" quick command, `/`) answers from data (empty DB: says there is nothing).
- [ ] Create a task via chat → confirm card → Task page shows it; "mai"/"thứ 6" resolved to the right date.
- [ ] Three tasks in one message → "Xác nhận tất cả (3)" creates all three.
- [ ] Edit a field on a card before confirming → the saved record has the edited value.
- [ ] "Hủy" a card → nothing saved, bot acknowledges and does not retry.
- [ ] "Đánh dấu xong task …" → bot looks the task up first (list_tasks), then shows an update card.
- [ ] Receipt photo (paste or drag in) → expense card with the amount from the image; thumbnail visible under Chi tiêu.
- [ ] Two images in one message attached to two different records.
- [ ] "So sánh chi tiêu tháng này với tháng trước" → bot uses query_readonly_sql, numbers match the Chi tiêu page.
- [ ] Wrong API key → "API key/token sai hoặc hết hạn…" + "Thử lại"; network off → "Không kết nối được tới LLM endpoint…"; "Dừng" mid-stream keeps the partial text.

**Pages**
- [ ] Task page: tick a task done; a weekly recurring task ticked → the next occurrence appears.
- [ ] Notes search without diacritics ("ngan sach") finds accented text ("ngân sách").
- [ ] Chi tiêu page shows this month grouped by category.
- [ ] Data pages refresh after a chat change and when the window regains focus.

**Reminders and tray**
- [ ] Reminder 2 minutes ahead → Windows toast on time, **with the window hidden in the tray**. Click → opens the Task page.
- [ ] Reminder while the app is quit → on next start one grouped "Bạn có N nhắc nhở" toast.
- [ ] Sleep the PC past a reminder, wake → toast fires shortly after resume.
- [ ] Tray: close hides the window, tray click shows it, right-click menu "Mở Trợ lý" / "Thoát" work; a second launch focuses the running instance.
- [ ] "Khởi động cùng Windows" (Settings or tray menu) on → sign out/in → app runs hidden in the tray. Note: the portable exe registers its own path, so moving the exe breaks this.
- [ ] Dark mode follows Windows.

If toasts don't appear from the portable exe (Windows can require a Start-menu shortcut carrying the
AppUserModelID `com.personal-assistant.app`), switch `win.target` to `nsis`, which creates that shortcut.
