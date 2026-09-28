# LLM gateway: separate connection method

Ngày: 2026-09-28 · Trạng thái: đã duyệt

## Bối cảnh

Người dùng cho biết LLM gateway là một phương thức kết nối riêng, không liên quan đến Azure Foundry. Chạy chẩn đoán với gateway thật (`https://…azurecontainerapps.io/v1`, token lưu trong app) cho kết quả:

| Hạng mục | Kết quả |
|---|---|
| Model | `GET /v1/models` chỉ trả về **`gpt-5.1-02`**. Tên khác bị từ chối `400 Unknown model` |
| Chat thường và stream SSE | ✅ Đúng dạng OpenAI (`chat.completion.chunk`, `data: [DONE]`). `finish_reason` viết hoa (`"Stop"`) |
| `tools` / function calling | ❌ **Bị bỏ qua âm thầm**. Model không nhận được danh sách tool |
| `content` dạng mảng (ảnh) | ❌ `400`: content phải là chuỗi |
| `assistant` có `content: null` + `tool_calls` | ❌ `400 Content field is required` |
| `role: 'tool'` với content là chuỗi | ✅ Được chấp nhận |
| Tool qua prompt (khối ```` ```tool_calls ````) | ✅ `gpt-5.1-02` trả đúng khối JSON, nhận kết quả rồi trả lời đúng |
| Mạng | Node fetch bị TLS inspection chặn. Đã chuyển sang Electron `net.fetch` (commit ed982a3) |

## Quyết định

| # | Quyết định | Lý do |
|---|---|---|
| G1 | Cấu hình LLM **tách theo provider**: `llm = { active, azure: {endpoint, model, apiVersion}, gateway: {endpoint, model} }`. Key vốn đã lưu riêng theo provider | Đổi provider không ghi đè cấu hình của nhau |
| G2 | Ô Model của gateway là Select lấy từ `GET /v1/models` (có nút tải lại), vẫn cho nhập tay. Gateway không có ô API version, và các câu mô tả không nhắc tới Foundry | Tên model của gateway không đoán được |
| G3 | Migration: setting `llm` cũ (một object phẳng) chuyển thành `{active: provider, [provider]: {...}}` ngay khi đọc | Giữ cấu hình hiện có của người dùng |
| G4 | **Adapter cho gateway**. Foundry giữ nguyên đường OpenAI tools | Gateway không hỗ trợ `tools` |
| G5 | Tool qua prompt: system prompt được nối thêm danh mục tool (tên, mô tả, JSON schema gọn) và giao thức: khi gọi tool thì CHỈ trả khối ```` ```tool_calls\n[{"name","arguments"}]\n``` ````. App parse khối này thành `ToolCall` với id tự sinh | Đã kiểm chứng trên gateway thật |
| G6 | Chuyển lịch sử cho gateway: assistant có tool_calls → `content` = text + khối tool_calls; message tool → `{role:'tool', content:'[Kết quả tool <name>]: <json>'}`; không bao giờ gửi content rỗng | Gateway bắt buộc content là chuỗi và không rỗng |
| G7 | Streaming: nếu phần đầu reply khớp tiền tố ```` ```tool_calls ```` thì giữ lại, không đẩy delta lên UI; ngược lại stream như thường | Không lộ JSON tool cho người dùng |
| G8 | Ảnh: gateway không nhận ảnh. Ảnh vẫn lưu làm attachment, model chỉ thấy nhãn `[ảnh #id]` kèm ghi chú "không đọc được ảnh". UI hiện cảnh báo khi gửi ảnh qua gateway | Giới hạn của gateway |
| G9 | Khối tool_calls lỗi (JSON sai, tool không tồn tại) → trả về model như lỗi tool để nó tự sửa, tính vào giới hạn 8 vòng | Giống cách xử lý lỗi tham số hiện có |

## Kiểm thử

- Unit test: parse khối tool_calls (thành công, nhiều call, JSON sai, text lẫn vào); chuyển lịch sử; migration cấu hình.
- Agent loop với fake gateway LLM (chỉ trả text): đọc → thẻ xác nhận → xác nhận → chạy tiếp.
- Chạy chẩn đoán với gateway thật sau khi làm xong (dùng token đã lưu, không in token).
