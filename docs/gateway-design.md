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
| G6 | Chuyển lịch sử cho gateway: assistant có tool_calls → `content` = text + khối tool_calls; message tool → `{role:'tool', content:'[Tool result <name>]: <json>'}`; không bao giờ gửi content rỗng | Gateway bắt buộc content là chuỗi và không rỗng |
| G7 | Streaming: nếu phần đầu reply khớp tiền tố ```` ```tool_calls ```` thì giữ lại, không đẩy delta lên UI; ngược lại stream như thường | Không lộ JSON tool cho người dùng |
| G8 | Ảnh: gateway không nhận ảnh. Ảnh vẫn lưu làm attachment, model chỉ thấy nhãn `[ảnh #id]` kèm ghi chú "không đọc được ảnh". UI hiện cảnh báo khi gửi ảnh qua gateway | Giới hạn của gateway |
| G9 | Khối tool_calls lỗi (JSON sai, tool không tồn tại) → trả về model như lỗi tool để nó tự sửa, tính vào giới hạn 8 vòng | Giống cách xử lý lỗi tham số hiện có |

## Kiểm thử

- Unit test: parse khối tool_calls (thành công, nhiều call, JSON sai, text lẫn vào); chuyển lịch sử; migration cấu hình.
- Agent loop với fake gateway LLM (chỉ trả text): đọc → thẻ xác nhận → xác nhận → chạy tiếp.
- Chạy chẩn đoán với gateway thật sau khi làm xong (dùng token đã lưu, không in token).

## As built

**Commit 1 `feat(settings): per-provider LLM config` (G1–G3)**
- `shared/types.ts`: `LlmSettings = { active, azure: {endpoint, model, apiVersion}, gateway: {endpoint, model} }` là dạng lưu dưới key `llm`. `LlmConfig` (phẳng, có `provider`) vẫn là đầu vào của `createLlm`; `activeLlm(settings)` trong `settings.ts` tạo ra nó (gateway có `apiVersion: ''`).
- `settings.ts`: `llmSettingsSchema` thay `llmConfigSchema`. Cả hai provider đều được kiểm tra (https, model trông giống key bị từ chối ở cả hai), nhưng chỉ provider `active` bắt buộc đủ: endpoint, và với Azure thêm deployment + API version. Provider kia được để trống.
- `getLlm(db)` migrate khi đọc: row cũ `{provider, endpoint, model, apiVersion}` thành `{active: provider, [provider]: {...}}`, phần còn lại là mặc định. Không ghi lại DB; lần Lưu tiếp theo ghi dạng mới. Row rác đọc ra mặc định.
- IPC `settings:listModels(provider)`: chỉ nhận `'gateway'` (khác thì `errors:invalidValue`). Gọi `GET <endpoint>/models` qua OpenAI SDK với endpoint và token **đã lưu**, dùng `net.fetch` như LLM. Lỗi: `errors:modelsNeedConfig` (chưa lưu endpoint/token), `errors:modelsFailed` bọc `describeLlmError` (vd 404 gợi ý thêm `/v1`).
- SettingsPage giữ `LlmSettings` trong state; đổi provider chỉ đổi `active` nên giá trị của từng bên được giữ. Model của gateway là Arco `Select` (`showSearch allowCreate allowClear`) cùng nút tải lại. Danh sách tự tải (không báo lỗi) khi gateway đang hiện, đã có token và endpoint đã lưu, và tải lại sau mỗi lần Lưu; nút tải lại thì báo lỗi bằng toast. Tải lỗi (tự động hay bấm nút) thì xóa danh sách, để không gợi ý model của endpoint cũ. `providerDesc` và `modelDescGateway` viết lại, không nhắc Foundry.

**Commit 2 `feat(llm): gateway adapter with prompt-based tool calling` (G4–G9)**
- `src/main/gateway.ts` (hàm thuần): `toolProtocol`, `parseToolCalls`, `visibleLength`, `toGatewayMessages`, `fromGateway`, `BAD_BLOCK`.
- `createLlm`: với gateway, request đi qua `toGatewayMessages` và không gửi `tools`; stream trả về đi qua `fromGateway`. `Llm.textOnly = true` với gateway. Đường Azure không đổi.
- G5: danh mục tool (tên, mô tả, `JSON.stringify` schema từ `toOpenAITools`) và giao thức được nối vào **cuối** system prompt (sau phần thông tin theo lượt; gateway không có prompt caching nên không ảnh hưởng). Id tự sinh `call_<8 hex>`. `arguments` có thể là object hoặc chuỗi JSON; một object đơn lẻ (không bọc mảng) cũng nhận.
- G6: assistant có tool_calls → text (trim) + khối JSON dựng lại từ tool_calls; tool → `[Tool result <name>]: <json>` (vẫn giữ `tool_call_id`, gateway thật chấp nhận); content rỗng thành `…`.
- Khối (regex `BLOCK`, dùng chung cho parser và stream nên hai bên luôn khớp nhau): sau ```` ```tool_calls ```` và xuống dòng, thân khối kéo tới ```` ``` ```` **ở đầu một dòng** (chuỗi JSON hợp lệ không chứa xuống dòng thật, nên một code fence nằm trong giá trị chuỗi, vd ghi chú có code, không đóng khối), hoặc tới hết reply nếu chưa đóng. Khối inline (JSON cùng dòng với fence) lấy phần còn lại của dòng, bỏ ```` ``` ```` ở cuối. CRLF được chấp nhận. Mọi fence đều khớp một dạng, nên phần bị ẩn luôn thành ít nhất một call (có thể là `invalid_tool_calls`).
- G7: `visibleText` = reply bỏ hết các khối; khi đang stream thì giữ lại thêm phần đuôi có thể là đầu của fence. `fromGateway` chỉ nối thêm phần mới của nó, nên text **trước và sau** một khối đã đóng đều hiện và được lưu làm `content`; khối chưa đóng ẩn tới hết.
- G8: `buildLlmMessages(deps, conv, textOnly)`: không đính ảnh, nhãn thành `[ảnh #id] (this model cannot see images, only the labels)`. `ChatPage` hiện toast `chat:gatewayNoImages` sau khi gửi tin có ảnh mà provider đang là gateway.
- G9: JSON sai hoặc phần tử thiếu `name` → một call `invalid_tool_calls` giữ nguyên khối gốc; `handleCall` trả `errors:badToolBlock` cho model, lịch sử phát lại đúng khối gốc. Tool không tồn tại / tham số sai dùng lỗi sẵn có. Mọi thứ vẫn tính vào `MAX_ROUNDS`.
- `collect` so `finish_reason` không phân biệt hoa thường (`"Stop"`, `"Length"`).

**Sau review (commit `fix(llm): …`)**
- Parser/stream theo quy tắc đóng khối ở đầu dòng ở trên (trước đó khối kết thúc ở ```` ``` ```` đầu tiên, kể cả trong chuỗi JSON: một `create_note` có code fence làm hỏng khối và đốt hết 8 vòng).
- `settings:save` dùng `parseLlmSettings`: lỗi của provider không hiện trên màn hình có tiền tố tên nó (`Azure AI Foundry: …` / `LLM gateway: …`). Tên provider nằm ở `PROVIDER_NAMES` (`shared/types.ts`).
- Hành vi chấp nhận, có chủ ý:
  - *Echo injection*: một khối ```` ```tool_calls ```` hợp lệ trong reply của model luôn được chạy, kể cả khi model chỉ trích dẫn lại (vd người dùng hoặc một ghi chú yêu cầu nó in ra khối đó). Tool đọc chỉ đọc; tool ghi vẫn phải qua thẻ xác nhận, nên không có thay đổi dữ liệu nào ngoài ý người dùng.
  - Fence không đúng giao thức (vd ```` ```json ````, ```` ``` tool_calls ````) không được chạy và hiện ra như text bình thường. Riêng ```` ```tool_calls <chữ khác> ```` trên dòng fence được coi là khối inline không hợp lệ: model nhận lỗi và gửi lại, phần các dòng sau hiện như text.

**Kiểm thử**: `tests/gateway.test.ts` (parse, fence streaming ở nhiều cỡ chunk, chuyển lịch sử, agent loop qua `createLlm` + SSE giả: đọc → trả lời, ghi → thẻ → xác nhận → chạy tiếp, khối lỗi → tự sửa, ảnh), migration trong `tests/settings.test.ts`, `listModels` trong `tests/llm.test.ts`.

**Chạy thật (2026-09-28)** bằng script Electron tạm (bản sao `Local State` + `secrets.bin` trong thư mục tạm, đã xóa; token không in ra): `gpt-5.1-02` trả khối `tool_calls` parse được (`get_today_overview`), rồi trả lời đúng từ kết quả tool; `create_task` → thẻ chờ → xác nhận → model báo đã lưu. Cấu hình đang lưu của người dùng có endpoint **không có `/v1`** (`GET /models` trả 404) và model `gpt-5.1` (gateway chỉ có `gpt-5.1-02`); cần sửa trong Cài đặt.

**Endpoint (4fadf9a):** ô Endpoint của gateway chỉ cần host. `gatewayBaseURL()` luôn gọi `<host>/v1/...`; nếu người dùng nhập kèm `/v1` thì bỏ đi để không thành `/v1/v1`.
