# Tìm và đọc file trên máy — thiết kế

Ngày: 2026-10-01. Liên quan: `src/main/agent.ts`, `src/main/tools/`, `src/main/ipc.ts`, `src/renderer/chat/SendBox.tsx`, `src/main/prompt.ts`.

## Tóm tắt

- AI được thêm tool **chỉ đọc** để tìm thư mục/file theo pattern, tìm chữ trong file và đọc file text trên máy. Không có tool nào sửa, xoá, đổi tên, mở hay chạy file, nên giới hạn "chỉ đọc" nằm trong code, không chỉ trong prompt.
- Phạm vi: toàn bộ thư mục người dùng (`~`). Tìm theo tên/pattern trên cả `~`; tìm chữ trong file chỉ trong một thư mục con cụ thể.
- Đọc mọi file text, bất kể đuôi; file nhị phân chỉ trả tên, kích thước, ngày sửa.
- Nút trong ô chat bật quyền **cho tin nhắn kế tiếp**; gửi xong nút tự tắt. Nút tắt thì AI không thấy các tool file.
- Chỗ nhạy cảm (khoá, token, AppData…) luôn bị chặn; không có thẻ xác nhận khi đọc (bấm nút là đồng ý), chip tool trong chat cho thấy file nào đã đọc.
- Ngoài phạm vi: ghi/sửa file, đọc PDF/Word/Excel, tìm ngoài `~`, chỉ mục tìm kiếm của hệ điều hành.

## Giả định

1. Nội dung file AI đọc được gửi lên LLM (Azure hoặc gateway) như mọi kết quả tool; người dùng chấp nhận điều này khi bấm nút.
2. Mỗi lần tìm: tối đa 200 kết quả, 10 giây. Mỗi lần đọc: khoảng 100 KB, đọc tiếp theo `from_line`. Tìm chữ chỉ quét file < 1 MB.
3. Khi duyệt bỏ qua thư mục rác nặng (`node_modules`, `.git`, `.cache`, thùng rác…); không đi theo symlink/junction.
4. Cờ bật có hiệu lực trong cả lượt trả lời, kể cả khi lượt đó tiếp tục sau thẻ xác nhận/thẻ hỏi.
5. Đường dẫn được kiểm tra ở main sau `realpath`; không thoát ra ngoài `~`.
6. Chạy được với Azure và gateway (gateway qua bộ chuyển prompt sẵn có). Không thêm thư viện.
7. Một người dùng, chạy cục bộ; không cần cache hay chỉ mục.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| F1 | Phạm vi là toàn bộ thư mục người dùng | Chỉ thư mục chọn trong Cài đặt; mọi ổ đĩa | Người dùng chọn; mọi ổ đĩa quá chậm và rủi ro |
| F2 | Tìm theo pattern, không giới hạn đuôi file | Chỉ đuôi text | Người dùng chọn |
| F3 | Đọc mọi file text; file nhị phân chỉ trả thông tin | Thêm tách chữ PDF/Word/Excel | Người dùng chọn; không thêm thư viện |
| F4 | Nút bật chỉ cho tin nhắn kế tiếp, cờ lưu trên tin nhắn người dùng | Bật cho cả hội thoại; công tắc chung toàn app | Người dùng chọn (kiểm soát chặt nhất); lưu trên tin nhắn để lượt tiếp tục sau thẻ vẫn đúng cờ |
| F5 | Tìm tên trên cả `~`, tìm chữ chỉ trong thư mục con | Chỉ tìm tên; tìm chữ ở mọi nơi | Người dùng chọn; grep cả `~` có thể mất vài phút |
| F6 | Tự chặn chỗ nhạy cảm, không thẻ xác nhận khi đọc | Thêm thẻ xác nhận mỗi lần đọc; không chặn gì | Người dùng chọn |
| F7 | Cách A: Node `fs` + `path.matchesGlob`, registry `FILE_TOOLS` riêng, tool loại `fs` async | B: đóng gói ripgrep; C: chỉ mục hệ điều hành | Không thêm phụ thuộc, chạy giống nhau trên ba hệ điều hành, dễ test; B nhiều rủi ro đóng gói, C mỗi OS một kiểu |
| F8 | Không migration: cờ là trường `files: true` trong JSON của tin nhắn | Cột mới trong `messages` | Tin nhắn đã lưu dạng JSON (`store.ts`) |
| F9 | Tool file nằm ngoài `TOOLS`/`findTool` | Chung registry | IPC `data:read` gọi được mọi tool `read`; renderer không được đọc file mà không qua nút |
| F10 | So tên và tìm chữ không phân biệt hoa thường và bỏ dấu (NFC trước) | So khớp chính xác | Người dùng hay gõ không dấu ("bao cao" khớp "Báo cáo") |

## Thiết kế

### 1. Kiến trúc và luồng dữ liệu

1. `SendBox.tsx`: nút `FolderSearch` cạnh nút ảnh. Bật thì nút sáng màu accent và placeholder đổi sang gợi ý tìm file; gửi thành công thì tự tắt, gửi lỗi thì giữ nguyên.
2. IPC `chat:send` nhận thêm `files: boolean`; main lưu tin nhắn người dùng `{ role: 'user', content, attachment_ids, files: true }`.
3. `runTurn`: mỗi vòng xem tin nhắn người dùng cuối có `files` không. Có thì gửi `toOpenAITools()` + 3 tool file và thêm vài câu vào system prompt (gốc là `~`, dùng `find_files` trước `read_file`, không bịa nội dung file); không thì chỉ bộ tool cũ.
4. `src/main/tools/files.ts`: `FILE_TOOLS`, loại `kind: 'fs'`, `run(args, { home, signal })` async, không nhận DB. `handleCall` chạy tool `fs` **trước** transaction rồi lưu kết quả trong transaction ngắn như cũ. Model gọi tool file khi cờ tắt thì nhận lỗi "file access is off for this message".
5. `findTool` (dùng bởi `data:read`) không thấy `FILE_TOOLS`.
6. Tin nhắn người dùng có `files` hiện nhãn nhỏ "📁 Tìm file"; lần gọi tool hiện chip như tool đọc hiện nay, kèm đường dẫn.

### 2. Tool

Đường dẫn trả về dạng `~/…`. Đường dẫn AI đưa vào được dạng `~/…`, tương đối (so với `~`) hoặc tuyệt đối, nhưng phải nằm trong `~`.

- `find_files({ pattern, under = "~", type = "any" | "file" | "dir", depth? })`
  - Glob không phân biệt hoa thường, bỏ dấu. Không có ký tự glob thì tìm chuỗi con (`bao cao` ≈ `*bao cao*`). Pattern có `/` so với đường dẫn tương đối, không có thì so với tên.
  - Kết quả `{ path, type, size, modified }[]`, kèm `truncated` / `skipped` khi có. `depth: 1` + `pattern: "*"` = liệt kê một thư mục.
- `grep_files({ query, under, glob?, regex = false })`
  - `under` bắt buộc và không được là `~`. Chuỗi không phân biệt hoa thường, bỏ dấu, hoặc regex.
  - Bỏ qua file nhị phân và file > 1 MB. Kết quả `{ path, line, text }`, `text` cắt khoảng 200 ký tự.
- `read_file({ path, from_line = 1 })`
  - File text: `{ path, content, from_line, to_line, more }`, tối đa khoảng 100 KB mỗi lần, đọc kiểu stream. UTF-8; UTF-16 nếu có BOM.
  - File nhị phân (byte `0` trong 8 KB đầu): `{ path, size, modified, binary: true }`.

Giới hạn chung: 200 kết quả, 10 giây, sau đó trả phần đã có kèm `truncated`. Không đi theo symlink/junction khi duyệt.

### 3. Chỗ bị bỏ qua và bị chặn

- **Bỏ qua khi duyệt** (vẫn đọc được nếu đưa đúng đường dẫn): `node_modules`, `.git`, `.cache`, `$Recycle.Bin`, `.Trash`, `__pycache__`, `.venv`.
- **Chặn hẳn** (không tìm thấy, không đọc được, lỗi "blocked"), so theo từng đoạn đường dẫn sau `realpath`:
  - Thư mục: `AppData`, `Library` (mac), `.config`, `.local`, `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `.docker`, `.password-store`. Dữ liệu của chính app nằm trong các thư mục này nên bị chặn theo.
  - File: `.env*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.kdbx`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`.

### 4. Lỗi và trường hợp biên

- Lỗi trong tool trả về AI dạng `{ error }`: "not found", "blocked: sensitive location", "file is locked" (EBUSY), v.v.
- Thư mục không có quyền khi duyệt: bỏ qua, đếm vào `skipped`.
- Nút Dừng: `signal` truyền vào tool, lần tìm đang chạy dừng ngay.
- `..`, đường dẫn tuyệt đối ngoài `~`, junction/symlink trỏ ra ngoài: chặn sau `realpath`.
- Tên file mac (NFD) chuẩn hoá NFC trước khi so.
- Prompt injection trong file: nội dung chỉ là kết quả tool; mọi lệnh ghi vẫn qua thẻ xác nhận.
- Lượt sau tắt nút: AI vẫn thấy kết quả cũ trong lịch sử 20 tin nhưng không đọc thêm được.

**Hạn chế đã biết**

- OneDrive "Files On-Demand": đọc hoặc tìm chữ trong file chỉ có trên mây khiến Windows tải file về; Node không nhận ra loại file này. Nếu thành vấn đề, thêm `OneDrive` vào danh sách bỏ qua khi tìm chữ.
- macOS có thể hỏi quyền truy cập Desktop/Documents/Downloads; app chưa ký nên có thể hỏi lại.

### 5. Test

- `tests/files.test.ts`, thư mục tạm làm `home` giả: glob, chuỗi con và không dấu, `depth`, `type`; giới hạn 200 và `truncated`; bỏ qua thư mục rác; chặn chỗ nhạy cảm; chặn `..` và junction ra ngoài (junction không cần admin trên Windows); nhận diện nhị phân; đọc phân trang theo `from_line`; UTF-16 BOM; `grep_files` từ chối `under` là `~`.
- `tests/agent.test.ts`: tool file chỉ gửi cho LLM khi tin nhắn có `files`; gọi khi cờ tắt thì lỗi; cờ còn sau khi tiếp tục từ thẻ xác nhận.
- IPC: `data:read` từ chối `read_file`.
- Chụp màn hình: nút bật/tắt, nhãn trên tin nhắn.
- Eval LLM thật (tuỳ chọn): 2–3 tình huống để xem gateway có dùng đúng tool.

## Đã làm (2026-10-01)

- Code: `src/main/tools/files.ts` (3 tool, `FILE_TOOLS`, `matcher`, `fileError`), loại tool `fs` trong `tools/common.ts`, `runFileCalls` + `filesOn` trong `agent.ts`, `FILE_RULES` trong `prompt.ts`, `files` qua `chat:send` (ipc/preload/useChat/ChatPage), nút `FolderSearch` trong `SendBox.tsx`, nhãn và dòng file đã tìm/đọc trong `MessageList.tsx`. `fold` (bỏ dấu) chuyển từ SQL sang hàm dùng chung trong `db.ts`.
- Khác thiết kế:
  - **Bỏ `regex` ở `grep_files`**: regex do model viết chạy đồng bộ trên main, một regex xấu (ReDoS) làm treo app. Chỉ còn tìm chuỗi không phân biệt hoa thường, bỏ dấu.
  - **Glob tự chuyển sang regex** thay vì `path.matchesGlob`: `matchesGlob` không khớp tên bắt đầu bằng dấu chấm và phân biệt hoa thường khác nhau theo hệ điều hành. Chỉ hỗ trợ `*`, `?`, `**`.
  - **Thư mục nhạy cảm chỉ bị chặn ở cấp đầu của `~`** (ví dụ `~/.config`, `~/AppData`), không chặn mọi thư mục tên `library` hay `.config` sâu bên trong dự án. File bí mật (`.env`, `*.pem`…) bị chặn ở mọi nơi.
  - Pattern có `/` so với đường dẫn tương đối **so với `under`**, không phải so với `~`.
  - Dòng hiển thị dưới câu trả lời là `under · pattern` hoặc đường dẫn file đã đọc (không phải chip có thể bấm).
- **Mở vị trí file (thêm sau, theo yêu cầu người dùng):** dưới câu trả lời, mỗi lần `find_files`/`grep_files` là một nhóm thu gọn được (mở sẵn khi ≤ 5 kết quả) liệt kê các `~/…` tìm được; `read_file` hiện đường dẫn đã đọc. Bấm một đường dẫn → IPC `files:reveal` → `revealTarget` (cùng luật `locate`: trong `~`, không bị chặn, tồn tại) → `shell.showItemInFolder`: Explorer/Finder/trình quản lý file mở thư mục chứa và chọn sẵn file. Không bao giờ mở hay chạy file. Kết quả lấy từ tin nhắn `tool` đi sau lời gọi (`fileResultsByMessage` trong `MessageList.tsx`).
- **macOS / Linux:**
  - `locate` lấy `realpath` làm chuẩn; so theo chữ chỉ dùng khi đường dẫn không tồn tại. Lý do: một thư mục người dùng có nhiều cách viết (mac `/var` ↔ `/private/var`, tên 8.3 trên Windows) làm phép so theo chữ từ chối nhầm.
  - `electron-builder.yml` thêm `NSDesktop/Documents/DownloadsFolderUsageDescription`: macOS hỏi quyền vào ba thư mục này ở lần tìm đầu tiên. App ký ad-hoc nên mỗi bản cập nhật có thể hỏi lại. Bị từ chối thì thư mục đó vào `skipped_folders`.
  - Linux: không cần quyền riêng; `showItemInFolder` dùng D-Bus `FileManager1` (Nautilus, Dolphin, Nemo…), không có thì mở thư mục chứa.
  - Hạn chế mac: iCloud Drive nằm trong `~/Library/Mobile Documents` nên bị chặn cùng `Library`; file Keynote `.key` bị ẩn vì trùng đuôi khoá riêng.
  - CI: test chạy trên Ubuntu (job `check`) và thêm bước test trên macOS trong job build. Chưa chạy thật trên máy mac/Linux.
- Kiểm tra: `tests/files.test.ts` (14 test, gồm junction ra ngoài `~`), 3 test mới trong `tests/agent.test.ts`; toàn bộ 297 test qua. Bấm đường dẫn được kiểm qua CDP với file không tồn tại (hiện lỗi); chưa bấm thử để mở Explorer thật. Chụp màn hình qua CDP trên hồ sơ tạm: nút bật/tắt, placeholder, nhãn "Tìm file", dòng file. **Chưa thử với LLM thật** (Azure/gateway) — gateway có thể cần ví dụ trong prompt như `ask_user`.
