# Provider Anthropic — thiết kế

Brainstorm 2026-10-12. Mục tiêu: user chỉ dán API key Anthropic rồi lưu là dùng được Claude, không nhập endpoint hay tên model.

## Hiểu yêu cầu

- Thêm provider thứ 4 `anthropic` bên cạnh `azure`, `gateway`, `lmstudio` ở Settings → Mô hình AI và setup guide.
- Form chỉ có: ô API key và bộ chọn **dòng** model (Haiku / Sonnet / Opus, mặc định Haiku). Không có ô Endpoint, Model, API version.
- App tự lấy model mới nhất của dòng đã chọn từ `GET /v1/models`.
- Tool-calling gốc, nhận ảnh/PDF (PDF đã được render thành JPEG theo trang), không `textOnly`.
- Key mã hóa trong `secrets.bin` như các provider khác; connect Anthropic tự vào "Connect đã lưu" (docs/connections-design.md).
- Non-goals: đăng nhập bằng subscription Pro/Max (đã dừng 2026-10-01, Anthropic không cho bên thứ ba), hiển thị thinking, prompt caching, Bedrock/Vertex, endpoint tùy chỉnh (proxy đã có provider gateway), hiển thị id model đang dùng.

## Assumptions

- Gọi qua lớp tương thích OpenAI của Anthropic (`https://api.anthropic.com/v1/`, Bearer key) bằng client `openai` đã có: không thêm dependency. Anthropic ghi lớp này "để test/so sánh, không phải giải pháp production lâu dài" nhưng cam kết không breaking; không có thinking, caching, `strict` bị bỏ qua. App hiện không dùng những thứ đó.
- Một user, key cá nhân. Key thuộc nhiều workspace cần header `anthropic-workspace-id` thì chưa hỗ trợ (sẽ báo lỗi 4xx).
- Key chỉ gửi tới `api.anthropic.com`, qua `fetch` đã có (net.fetch ở Electron, fetch của Node ở Docker). Máy có Zscaler vẫn cần cert như các provider khác.
- Retry 2 lần, timeout 60 giây như Azure/gateway.

## Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| A1 | Provider riêng `anthropic`, endpoint cố định | Ô Endpoint tùy chỉnh | Proxy công ty đã có provider gateway; user chỉ muốn dán key |
| A2 | Không có ô Model; user chọn dòng, mặc định Haiku | Gõ id tay; hardcode một id | Id tay khó dùng, id hardcode sẽ lỗi thời khi model bị retire |
| A3 | `model` của slot lưu bí danh dòng (`haiku`/`sonnet`/`opus`), không lưu id thật | Thêm trường `line` riêng; lưu id đã phân giải | Dedupe, tên connect, `useConnection`, `isInUse`, `seedConnections` chạy nguyên không sửa; id lưu sẵn sẽ cũ |
| A4 | Phân giải dòng → id lúc gọi, cache trong bộ nhớ 1 giờ theo (dòng, hash key) | Phân giải lúc Save; gọi list mỗi lượt | Tự theo model mới; không tốn request mỗi lượt chat |
| A5 | Lọc `line === alias`, bỏ `deprecated`/`retired`, lấy `created_at` mới nhất; không suy dòng từ id | Parse tên id | Doc Anthropic: "do not infer a line from the id" |
| A6 | Lớp tương thích OpenAI (cách A) | SDK gốc + bộ chuyển đổi (cách B); gateway trỏ api.anthropic.com (cách C) | Không dependency, ~60 dòng, không đụng agent/collect; `Llm` interface cho phép thay bằng B sau |
| A7 | `createLlm` bỏ qua `cfg.endpoint` đã lưu cho Anthropic, luôn dùng hằng số | Tin endpoint trong settings | Key không bao giờ ra khỏi api.anthropic.com dù settings bị sửa tay |
| A8 | Lỗi 404 khi chat xóa cache của dòng đó | Để hết TTL | Model vừa bị retire thì lượt sau phân giải lại |

## Thiết kế

**Dữ liệu (`src/shared/types.ts`, `src/main/settings.ts`)**
- `Provider` thêm `'anthropic'`; `PROVIDER_NAMES.anthropic = 'Anthropic'`; `LlmSettings.anthropic: { endpoint; model }`; `DEFAULT_LLM.anthropic = { endpoint: 'https://api.anthropic.com', model: 'haiku' }`; `ANTHROPIC_LINES = ['haiku','sonnet','opus']`.
- Zod: `active` thêm `'anthropic'`; `anthropic: z.object({ endpoint, model }).default(...)`; refine `model ∈ ANTHROPIC_LINES` khi provider là anthropic (kể cả không active, theo cách các provider khác được kiểm). `getLlm` merge mặc định.
- `SettingsView.hasKey` và `settings:get` thêm `anthropic`.

**Gọi LLM (`src/main/llm.ts`)**
- `createLlm`: nhánh anthropic dùng `new OpenAI({ baseURL: 'https://api.anthropic.com/v1/', apiKey, maxRetries: 2, timeout: 60_000, fetch })`; trong `stream()` gọi `resolveAnthropicModel(alias, key, fetch)` rồi gửi `tools` và ảnh như Azure.
- `resolveAnthropicModel`: `GET /v1/models?limit=1000` với `x-api-key` + `anthropic-version: 2023-06-01`; cache 1 giờ. Không có model thuộc dòng → `UserError('anthropicNoModel', { line })`.
- `settings:listModels` không đổi (không dùng cho anthropic).

**UI (`ModelForm.tsx`, locales)**
- Segment "Anthropic" ở bộ chọn provider (Settings và compact).
- Khi active = anthropic: ẩn Endpoint/Model/API version/nút reload; hiện `Segmented` "Dòng model" (Haiku/Sonnet/Opus) + mô tả; nhãn key là `API key`. `modelsReady` false nên không tự tải danh sách.
- vi/en: `anthropicLine`, `anthropicLineDesc`, lỗi `anthropicNoModel`.

## Lỗi và edge case

- Key sai/hết hạn: list hoặc chat trả 401/403 → thông báo `llmAuth` có sẵn. 429 → `llmRateLimit`. Mất mạng khi list → `llmConnection`. Mọi lỗi khác → `llmError` kèm status.
- Tài khoản không có model của dòng đã chọn (vd. Opus) → `anthropicNoModel`: "Tài khoản không có model nào thuộc dòng Opus. Chọn dòng khác."
- Đổi dòng giữa hội thoại được: lịch sử là tin nhắn OpenAI thuần, `buildLlmMessages` luôn bắt đầu bằng tin user.
- Đổi dòng tạo thêm một connect đã lưu ("sonnet · Anthropic") dùng cùng key; xóa/đổi tên như các connect khác.
- Dữ liệu cũ không có khối `anthropic` → mặc định, không migrate.
- Rủi ro đã biết: lớp tương thích bỏ qua `strict`, nên tool-args không được đảm bảo theo schema (agent đã tự xử lý args lỗi bằng `invalidArgs`).

## Kiểm thử

- `tests/llm.test.ts`: baseURL và Bearer đúng; model phân giải đúng dòng và đúng bản mới nhất; bỏ qua deprecated/retired/`line: null`; cache (một request list cho hai lượt); 404 xóa cache; 401 → `llmAuth`; không có model → `anthropicNoModel`; không `textOnly`; thiếu key → `llmNotConfigured`.
- `tests/settings.test.ts`: schema nhận haiku/sonnet/opus, từ chối model khác; thiếu khối `anthropic` → mặc định; remember/use/seed connect Anthropic.
- `tests/server.test.ts`: `settings:save` anthropic → `hasKey.anthropic`, không lộ key, connect "haiku · Anthropic" xuất hiện.
- `tests/i18n.test.ts`: vi và en đủ key.
- `docker build --target test` (typecheck + vitest), rồi build image và xem Settings trên browser. Gọi thật tới Anthropic **không test được** nếu không có key: user kiểm bằng Lưu & test, một lượt chat gọi tool, một lượt có ảnh.

## Đã làm (2026-10-12)

- `src/shared/types.ts`: `Provider` + `'anthropic'`, `ANTHROPIC_ENDPOINT`, `ANTHROPIC_LINES`, `LlmSettings.anthropic`, `DEFAULT_LLM.anthropic` (haiku).
- `src/main/settings.ts`: zod nhận `anthropic` (có default) và chỉ cho `model` là một dòng; `getLlm` merge mặc định.
- `src/main/llm.ts`: `resolveAnthropicModel` (GET /v1/models, lọc `line` + `lifecycle`, cache 1 giờ, 404 xóa cache); `createLlm` dùng host cố định, tools và ảnh gốc.
- `src/main/ipc.ts`: `hasKey.anthropic`. Renderer: segment Anthropic + "Dòng model" trong `ModelForm`; locale vi/en.
- Kiểm tra: `docker build --target test` (typecheck + 445 test). Build image web, chạy container tạm: `settings:save`/`get` đúng, connect "opus · Anthropic" xuất hiện, Settings hiển thị đúng form (ảnh chụp trên browser). Gọi thật từ container tới api.anthropic.com với key giả → 401 → "API key sai hoặc hết hạn".
- **Chưa kiểm:** gọi chat thật với key hợp lệ (tool-calling, ảnh/PDF qua lớp tương thích), và setup guide (Welcome, bản compact) với 4 segment. Cần key thật để kiểm.
