# Connect LLM đã lưu — thiết kế

Brainstorm 2026-10-07. Mục tiêu: user bấm lại một connect LLM cũ (provider + endpoint + model + key) mà không phải nhập lại.

## Hiểu yêu cầu

- Trước đây: 1 ô cấu hình + 1 key cho mỗi provider (`settings.llm`, `secrets.bin` khóa theo provider). Đổi endpoint/model là ghi đè bản cũ.
- Một connect = provider + endpoint + model/deployment + apiVersion (Azure) + API key. Bấm một connect → nó thành connect đang dùng ngay.
- Tự thêm khi Lưu / Lưu & Test; tên tự sinh, đổi tên và xóa được. Chỉ hiện ở Settings → Mô hình AI.
- Non-goals: đổi nhanh ở chat header, import/export, đồng bộ máy, đụng prompt/tools/agent/gateway adapter.

## Assumptions

- Key vẫn mã hóa bằng `Cipher` trong `secrets.bin`, không vào DB, không gửi về renderer (renderer chỉ thấy danh sách không có key).
- Tối đa 20 connect (ước lượng); vượt thì bỏ cái dùng lâu nhất.
- Một user, vài connect → không phân trang.

## Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| C1 | Giữ nguyên `LlmSettings` (3 ô provider + `active`) là "connect đang dùng"; danh sách connect là row riêng `connections` | Thay `LlmSettings` bằng danh sách + `activeId` | `activeLlm`/`createLlm`/ModelForm/Welcome/`useModelInfo`/App đều đọc ô provider; giữ nguyên thì diff nhỏ, không migrate khó |
| C2 | "Dùng connect" = ghi cấu hình + key của nó vào ô provider tương ứng và đặt `active` | Lưu `activeId` và resolve khi gọi LLM | Như C1; ô cũ đã được lưu thành connect nên không mất gì |
| C3 | Key của connect lưu trong `secrets.bin` dưới khóa `conn:<id>` | File secrets thứ hai; key trong DB | Một file mã hóa sẵn có; DB bị `query_readonly_sql` đọc được (D14) |
| C4 | Nhận diện trùng theo (provider, endpoint, model, apiVersion); key mới ghi đè key cũ của connect đó | Trùng cả key | Cùng đích mà đổi key (xoay token) không nên sinh bản sao |
| C5 | Thêm khi `settings:save` thành công (Test cũng gọi save trước) và provider có key (LM Studio không cần) | Chỉ thêm khi Test OK | Test lỗi mạng không nên chặn việc nhớ cấu hình; sửa/xóa được nếu sai |
| C6 | Active = ô provider đang dùng khớp connect (so sánh cấu hình), không lưu cờ | Cờ `active` trong connect | Không có hai nguồn sự thật |
| C7 | Xóa connect đang dùng chỉ xóa khỏi danh sách; cấu hình đang chạy giữ nguyên | Tự chuyển sang connect khác | Không đổi LLM sau lưng user; lần Lưu sau sẽ thêm lại |
| C8 | Lần `settings:get` đầu (chưa có row `connections`) seed từ các ô hiện có: ô active, và ô nào có key | Không migrate | Không mất cấu hình cũ |

## Đã làm (2026-10-07)

- `src/main/settings.ts`: `getConnections`, `rememberConnection`, `seedConnections`, `useConnection`, `renameConnection`, `removeConnection`; `writeSecret(name, undefined)` xóa một secret. IPC `connections:use|rename|remove`, `settings:get` trả thêm `connections` (không có key), `settings:save` gọi `rememberConnection` sau khi ghi.
- Renderer: `ConnectionList` trong `ModelForm` (chỉ bản không `compact`, tức Settings): Dùng / đổi tên inline / xóa; "Đang dùng" = connect khớp cấu hình provider đang active.
- Khác thiết kế: connect được nhớ ngay khi **Lưu** thành công (Lưu & Test cũng gọi Lưu trước), kể cả Test sau đó lỗi (C5).
- Kiểm tra: `docker build --target test` (typecheck + 435 test, gồm `settings.test.ts` "saved connections" và một ca end-to-end qua HTTP trong `server.test.ts`). **Chưa xem UI trên browser**: Chrome extension không mở được container (trang lỗi dù `curl` 200), nên danh sách chưa được kiểm bằng mắt.
