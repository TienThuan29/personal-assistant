# Smoke test (run before each release)

Setup: install the packaged app (`bun run pack` → run `release/PersonalAssistant-Setup-0.1.0.exe`; per-user, no admin prompt,
adds a Start-menu shortcut), real LLM configured. Uninstall from Windows Settings → Apps (keeps the data folder).
The packaged app shares its data folder with `bun run dev`: `%APPDATA%/personal-assistant/`
(`assistant.db`, `attachments/`, `backups/`, `secrets.bin`). Rename it first for a truly fresh start.

**Start and settings**
- [ ] Installer: no admin prompt, the app starts when it finishes, the Start menu has "Personal Assistant".
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
- [ ] Hôm nay: overdue and today's tasks (tick one → it leaves the list), today's and next 7 days' reminders ("Bỏ qua" and delete work), today's spending total.
- [ ] Task page: tick a task done; a weekly recurring task ticked → the next occurrence appears.
- [ ] Notes search without diacritics ("ngan sach") finds accented text ("ngân sách").
- [ ] Chi tiêu page shows this month grouped by category.
- [ ] Data pages refresh after a chat change and when the window regains focus.

**Manual CRUD** (docs/crud-design.md)
- [ ] Task: "+ Thêm" with a date, time, weekly T2/T4 repeat and 2 pasted images → saved, images show. Edit it: change the title, remove one image, add one → only those change. Typing "Công việc" as the category files it under the Công việc filter. Status filter Đã xong shows a ticked task; setting it back to Chưa xong reopens it.
- [ ] Note: "+ Thêm" a journal entry; clicking a note opens the edit form with its full body; search still works while the form is closed.
- [ ] Expense: "+ Thêm" 12.50 USD → the table shows $12.50 / 12,50 US$; editing and saving without changes sends nothing; 55000 VND round-trips.
- [ ] Reminder page: "+ Thêm" 2 minutes ahead → toast on time; edit the text of a fired reminder (Đã nhắc) → saved without a "past time" error; moving its time to the future → back under Sắp tới and fires again.
- [ ] Any form: closing with changes asks "Bỏ thay đổi?"; Ctrl+Enter saves; a server error (e.g. a past reminder time typed by hand) shows inside the modal and keeps the input; 11th image is refused.

**Reminders and tray**
- [ ] Reminder 2 minutes ahead → Windows toast on time, **with the window hidden in the tray**. Click → opens the Hôm nay page.
- [ ] Reminder while the app is quit → on next start one grouped "Bạn có N nhắc nhở" toast.
- [ ] Sleep the PC past a reminder, wake → toast fires shortly after resume.
- [ ] Tray: close hides the window, tray click shows it, right-click menu "Mở Trợ lý" / "Thoát" work; a second launch focuses the running instance.
- [ ] "Khởi động cùng Windows" (Settings or tray menu) on → sign out/in → app runs hidden in the tray. The Settings switch applies at once (no "Lưu"), even with no LLM configured, and "Lưu" later does not undo a tray change.
- [ ] Dark mode follows Windows.

**Language and display** (Settings → Hiển thị / Display)
- [ ] Language → English: the sider, the current page, Arco widgets (date pickers, pagination, empty states) and the window title switch at once, with no reload. Tray tooltip and right-click menu ("Open Assistant" / "Quit") are English; the next reminder toast is "Reminder" (grouped: "You have N reminders"). A validation error (e.g. a past reminder via chat) is English.
- [ ] Money style Vietnamese ↔ International changes every amount (Today, Expenses, confirm cards) at once. Default currency: "USD" is used by a new expense without a currency; typing "US" + Enter does nothing.
- [ ] Restart: the chosen language and money style persist. Switch back to Tiếng Việt → everything is Vietnamese again.

Toasts need the Start-menu shortcut carrying the AppUserModelID `com.personal-assistant.app`, which the installer
creates. `release/win-unpacked/Personal Assistant.exe` run directly may show no toasts.
