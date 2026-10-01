# Smoke test (run before each release)

Setup: install the packaged app (`bun run pack` → run `release/PersonalAssistant-win-x64-setup.exe`; per-user, no admin prompt,
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

**UI refresh** (docs/ui-refresh-design.md)
- [ ] Shortcuts: Ctrl+N opens a new chat (holding it makes only one); Ctrl+1…5 open Hôm nay, Task, Ghi chú, Chi tiêu, Nhắc nhở; Ctrl+, opens Cài đặt; Ctrl+B collapses/expands the sidebar. With a "+ Thêm" form open, none of them fire.
- [ ] Rename a conversation three ways: "⋯" → Đổi tên; double-click the title; keyboard only (Tab to the row, Tab to "⋯", Enter, Enter on Đổi tên). Enter or clicking away saves, Escape cancels, an empty title is ignored. The renamed chat does not jump in the list, and a later reply does not overwrite the name.
- [ ] Collapse the sidebar (button or Ctrl+B) → icons only, hovering one shows its label and shortcut. Quit from the tray and restart → still collapsed.
- [ ] Hôm nay: "+ Thêm task" opens the task form on the page and the list updates after saving; "Hỏi trợ lý" opens the latest chat with the cursor in the composer. A day with nothing on it shows "Hôm nay thảnh thơi".
- [ ] Chi tiêu: "‹" / "›" step one month, clicking the month label opens the month picker. Clicking a category in the legend filters the list below to it; clicking it again (or the "✕" chip) clears the filter.
- [ ] Ghi chú: clicking anywhere on a card opens the edit form; hovering (or Tab onto) a card shows Sửa/Xóa, and Xóa asks to confirm without opening the note. Clicking a thumbnail zooms the image instead of opening the note.
- [ ] Dark mode: switch Windows to dark (Settings → Personalization → Colors) while the app runs → every page (Hôm nay, Task, Ghi chú, Chi tiêu, Nhắc nhở, Cài đặt, a chat with a confirm card, a "+ Thêm" form) turns dark with readable text, no white or blue patches. Switch back → light again.

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
- [ ] Màu chủ đạo (docs/accent-color-design.md): click Biển → buttons, links, the active sidebar icon, chat bubbles and the faint background tint turn blue at once on every page; expense category colours stay the same. Arrow keys move between swatches and select them.
- [ ] Rainbow swatch → picker: dragging previews live; Esc reverts and closes; clicking outside saves and the rainbow swatch shows the picked colour. Pick a pale yellow → buttons and links are a readable darker olive in light mode.
- [ ] Restart → the colour persists. Switch Windows to dark → still readable. Click Đất nung → the app looks exactly as before.

**App icon** (docs/app-icon-design.md)
- [ ] After installing: the installer, the installed Personal Assistant.exe, the Start-menu shortcut, the taskbar button, the window and the tray show the blue chat-bubble icon, not Electron's default. Hover the tray icon: tooltip still shows.
- [ ] An old icon lingers on a pinned shortcut or in Explorer → unpin/re-pin, or restart Explorer (the Windows icon cache), before suspecting the build.

Toasts need the Start-menu shortcut carrying the AppUserModelID `com.personal-assistant.app`, which the installer
creates. `release/win-unpacked/Personal Assistant.exe` run directly may show no toasts.
