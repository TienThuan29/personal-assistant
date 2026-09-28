# Personal Assistant: Design

Ngày: 2026-09-28 · Trạng thái: đã duyệt (brainstorming), chưa implement

App desktop quản lý cá nhân. Trung tâm là một chatbot trợ lý, dùng tool (harness) để đọc/ghi SQLite local.
UI dựng bằng `@aionui/ui` (`../aionui-ui`).

---

## 1. Understanding summary

- **Sản phẩm:** Electron app ở `ElectronUI-Extraction/personal-assistant`, repo riêng, dùng `@aionui/ui` qua `file:../aionui-ui`.
- **Cốt lõi:** chatbot trợ lý cá nhân, gọi tool để truy vấn và ghi vào SQLite.
- **Module MVP:** Task (một bảng, có `category` công việc/cá nhân), Nhắc nhở, Ghi chú/Nhật ký, Chi tiêu.
- **Ảnh:** user gửi nhiều ảnh trong một tin. Ảnh được lưu làm attachment, **đồng thời** LLM đọc ảnh để điền field.
- **LLM:** Azure Foundry **hoặc** LLM gateway (baseURL + access token). Cả hai đều OpenAI-compatible (`/chat/completions`, tools, `image_url`).
- **Xác nhận:** **mọi** thao tác ghi do bot đề xuất phải được user xác nhận qua card.
- **UI:** chat là màn chính, sider có danh sách hội thoại và trang xem nhanh Task / Ghi chú / Chi tiêu. App chạy nền ở system tray để nhắc nhở.
- **Non-goals:** sync cloud, mobile, nhiều người dùng, embeddings/vector search, E2E test, i18n ngoài tiếng Việt.

## 2. Assumptions

1. Một user, một máy **Windows**. UI tiếng Việt, bot trả lời theo ngôn ngữ user dùng. "Hôm nay" tính theo giờ máy, tiền mặc định VND.
2. Quy mô vài chục nghìn bản ghi. Query < 50ms, không cần index đặc biệt ngoài vài index theo ngày.
3. Model được cấu hình hỗ trợ cả tool calling và vision (GPT-4o/4.1, Claude...).
4. Chỉ nội dung chat và ảnh được gửi tới endpoint LLM do user cấu hình. DB không rời khỏi máy.
5. Secret (API key/token) mã hóa bằng `safeStorage` (DPAPI) và lưu ở file riêng, không nằm trong DB.
6. Tìm ghi chú bằng SQLite FTS5 là đủ.
7. User tự bảo trì app. Backup tự động 7 bản là đủ để phục hồi.

## 3. Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| D1 | Repo mới cạnh `aionui-ui`, dep `file:../aionui-ui` | Đặt trong `aionui-ui/apps/` | Tách mục đích thư viện và app |
| D2 | Một client SDK `openai`: `AzureOpenAI` cho Foundry, `OpenAI({baseURL})` cho gateway | Vercel AI SDK, nhiều adapter | Cả hai endpoint đều OpenAI-compatible, một dependency |
| D3 | Driver `node:sqlite` (có sẵn trong Electron 37.10.3 / Node 22.21, đã kiểm tra FTS5 + tiếng Việt) | `better-sqlite3`, `sql.js` | `better-sqlite3` không build được trên máy này (Node 26 + proxy TLS). `sql.js` phải tự lưu file |
| D4 | Harness kiểu **typed tools + `query_readonly_sql` + propose/confirm** | Một tool SQL tổng quát; MCP server | Card xác nhận đọc được, validate ở ranh giới, không thể phá schema. MCP để sau (YAGNI) |
| D5 | Agent loop, DB, secret và lời gọi LLM đều ở **main process** | Gọi LLM từ renderer | Không lộ key ra renderer, không vướng CORS |
| D6 | **Luôn xác nhận** mọi thao tác ghi do bot đề xuất | Chỉ xác nhận khi xóa/bulk; không bao giờ hỏi | User chọn |
| D7 | Thao tác trực tiếp trên trang xem nhanh (tick, xóa) **không** cần xác nhận | Xác nhận cả ở UI | Cú click đã thể hiện ý định. D6 chỉ nhắm vào đề xuất của bot |
| D8 | Task công việc/cá nhân chung một bảng, phân biệt bằng `category` | Module kanban riêng | User chọn, đơn giản |
| D9 | Nhiều hội thoại, lưu trong SQLite. Mỗi lượt gửi ~20 message gần nhất | Một luồng chat; không lưu | User chọn. Dữ liệu thật nằm trong DB nên không cần nhớ dài |
| D10 | Chạy nền ở tray, có tùy chọn khởi động cùng Windows | Chỉ nhắc khi app mở | User chọn |
| D11 | Task lặp: khi hoàn thành mới sinh bản kế tiếp | Sinh sẵn nhiều bản | Không phải dọn bản thừa khi đổi lịch |
| D12 | Tiền lưu `INTEGER` theo đơn vị nhỏ nhất | `REAL` | Tránh sai số float |
| D13 | Hard delete + backup `VACUUM INTO` mỗi lần mở app (giữ 7) | Soft delete | Đã có xác nhận và backup, schema đơn giản hơn |
| D14 | Secret ở `userData/secrets.bin`, không trong DB | Bảng `settings` | `query_readonly_sql` không thể đọc secret rồi gửi cho LLM |
| D15 | Schema tool bằng **zod**, sinh JSON Schema bằng `z.toJSONSchema` | JSON Schema viết tay + validator riêng | Một nguồn cho cả schema và validate. Args được validate lại khi xác nhận |
| D16 | Resize ảnh bằng `nativeImage` (tối đa 1568px, JPEG) | `sharp` | Có sẵn trong Electron, không thêm native dep |
| D17 | Tìm ghi chú bằng FTS5 `unicode61 remove_diacritics 2` | Embeddings | Đủ dùng, "chao" khớp "chào", không cần hạ tầng vector |

## 4. Kiến trúc

```
personal-assistant/
├─ src/main/
│  ├─ db/          node:sqlite, migrations (PRAGMA user_version), backup
│  ├─ agent/       vòng lặp LLM ↔ tools, system prompt
│  ├─ tools/       tasks.ts, reminders.ts, notes.ts, expenses.ts, sql.ts
│  ├─ llm/         tạo client từ settings
│  ├─ reminders/   scheduler + Notification
│  └─ ipc.ts
├─ src/preload/    contextBridge, API có kiểu
└─ src/renderer/   React 19 + @aionui/ui + Arco
```

Build bằng `electron-vite`, giống `aionui-ui/playground`.
Bảo mật: `contextIsolation: true`, `sandbox: true`, không `nodeIntegration`. Ảnh được phục vụ qua custom protocol `att://<id>`.

### Luồng một tin nhắn

1. Renderer gửi `chat:send {conversationId, text, imagePaths[]}`.
2. Main lưu message và copy ảnh vào `userData/attachments/<uuid>.jpg` (`owner_type='message'`), rồi gọi LLM ở chế độ stream kèm tools.
3. Tool **đọc** chạy ngay, kết quả đưa lại cho model, lặp tiếp (tối đa **8 vòng**/lượt, có nút Dừng qua `AbortController`).
4. Tool **ghi** tạo bản ghi `pending_actions` và dừng vòng lặp, renderer hiện `ConfirmCard`.
5. Khi user Xác nhận (có thể sửa field), args được validate lại, chạy trong transaction, kết quả trả về model để model viết câu chốt. Khi Hủy, model nhận `"user đã hủy"`.
6. Token được stream về renderer qua `chat:event`.

Mỗi lượt gửi cho LLM: system prompt, ~20 message gần nhất và định nghĩa tools. Dữ liệu **không** được nhồi vào prompt.

## 5. Data model

```sql
tasks(id, title, notes, category TEXT DEFAULT 'personal',
      priority INT DEFAULT 2 CHECK(priority IN (1,2,3)),
      due_date TEXT,        -- 'YYYY-MM-DD' giờ máy
      due_time TEXT,        -- 'HH:MM' | NULL
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo','done','cancelled')),
      recurrence TEXT,      -- 'daily' | 'weekly:1,3,5' | 'monthly:15' | NULL
      created_at, completed_at)

reminders(id, task_id NULL REFERENCES tasks ON DELETE CASCADE,
          message, remind_at TEXT,   -- ISO UTC (toISOString), để sắp xếp theo chuỗi
          status TEXT CHECK(status IN ('pending','fired','dismissed')))

notes(id, kind TEXT CHECK(kind IN ('note','journal')), title, body, created_at, updated_at)
notes_fts USING fts5(title, body, content='notes', tokenize='unicode61 remove_diacritics 2')

expenses(id, amount INTEGER, currency TEXT DEFAULT 'VND', category, description, spent_at TEXT, created_at)

attachments(id, owner_type CHECK(owner_type IN ('task','note','expense','message')),
            owner_id, file_name, mime, created_at)

conversations(id, title, created_at, updated_at)
messages(id, conversation_id, role, content JSON, created_at)   -- format OpenAI, replay được
pending_actions(id, conversation_id, tool_call_id, tool_name, args JSON,
                status CHECK(status IN ('pending','confirmed','cancelled')), result JSON)
settings(key PRIMARY KEY, value)   -- chỉ giá trị không bí mật
```

- `journal_mode=WAL`, `foreign_keys=ON`. Migration là mảng SQL chạy theo `user_version`, trong transaction.
- `category` là text tự do. System prompt liệt kê các category đang có để bot dùng nhất quán.
- Khi xác nhận `create_*`, attachment của message được **gắn lại** (`owner_type/owner_id`) sang bản ghi mới, không copy file.
- File ảnh mồ côi được dọn lúc khởi động.

## 6. Tools

**Đọc (chạy ngay):**

| Tool | Mô tả |
|---|---|
| `get_today_overview()` | task hôm nay + quá hạn, nhắc nhở hôm nay, tổng chi hôm nay |
| `list_tasks({from?, to?, status?, category?, query?})` | |
| `list_reminders({from?, to?})` | |
| `search_notes({query, kind?, from?, to?})` | FTS5, trả đoạn trích |
| `list_expenses({from, to, category?})` | kèm tổng |
| `query_readonly_sql({sql})` | connection `readOnly`, chỉ `SELECT`/`WITH`, tối đa 200 dòng |

**Ghi (thành pending action, chờ xác nhận).** Mỗi entity `task | reminder | note | expense` có:
- `create_<entity>({..., attachment_ids?})`
- `update_<entity>s({ids[], patch})`: với task, tool này đã bao gồm hoàn thành, dời lịch hàng loạt và đổi category.
- `delete_<entity>s({ids[]})`

**Quy tắc:**
- Tin nhắn có ảnh được gửi dạng `image_url` (base64 đã resize) kèm text `[ảnh #<id>]`. Model tự chọn `attachment_ids` cho từng bản ghi.
- Với `update_*` / `delete_*`, main đọc sẵn bản ghi hiện tại để card hiện **trước → sau**, hoặc danh sách sẽ bị xóa.
- Nhiều lệnh ghi trong một lượt được gom thành một nhóm card (Xác nhận tất cả hoặc từng mục). Vòng lặp chỉ chạy tiếp khi mọi pending action trong lượt đã được xử lý.
- **System prompt:**
  - vai trò trợ lý; ngày giờ hiện tại, thứ trong tuần và múi giờ;
  - luôn query trước khi khẳng định; đổi ngày tương đối thành ngày tuyệt đối;
  - hỏi lại khi mơ hồ; không bịa ID; trả lời theo ngôn ngữ của user.
- Slash command (`SlashCommandMenu`): `/homnay`, `/tuannay`, `/chitieu`. Đây chỉ là prompt soạn sẵn.

## 7. UI

- **Từ `@aionui/ui`:**
  - Khung app: `WindowControls`; sider dựng từ `SiderItem`/`CollapseGroup` (Hội thoại, Hôm nay, Task, Ghi chú, Chi tiêu, Cài đặt).
  - Chat: `AionScrollArea` + `useAutoScroll`, `Markdown`, `ThoughtDisplay` (trạng thái gọi tool).
  - Ảnh và lệnh: `FilePreview`, `AionModal` (xem ảnh), `SlashCommandMenu`.
  - Tìm kiếm và settings: `AionSearchInput`, `SettingsPageHeader`, `SectionCard`, `PreferenceRow`, `AionSelect`.
- **Tự viết:**
  - `SendBox`: textarea, dán/kéo-thả nhiều ảnh, Gửi/Dừng.
  - `MessageList`.
  - `ConfirmCard`: mỗi entity một renderer, form Arco sửa được.
- **Trang xem nhanh:**
  - Task nhóm theo Quá hạn / Hôm nay / Sắp tới, lọc theo category.
  - Ghi chú có tìm kiếm FTS.
  - Chi tiêu xem theo tháng, kèm tổng theo category.
- **Settings:**
  - Provider (Foundry | Gateway), endpoint, deployment/model, API version (Foundry), key/token.
  - Nút "Kiểm tra kết nối".
  - Khởi động cùng Windows.

## 8. Nhắc nhở

- Main chỉ giữ một `setTimeout` tới nhắc nhở `pending` gần nhất, tối đa 1h rồi tính lại.
- Tính lại khi bảng `reminders` thay đổi và khi `powerMonitor` phát `resume`.
- Nhắc nhở bị lỡ (app tắt) được gom thành một thông báo lúc khởi động.
- Bấm thông báo thì mở cửa sổ tới task liên quan.
- Bắt buộc `app.setAppUserModelId` để toast Windows hoạt động.
- Đóng cửa sổ thì thu xuống tray. Menu tray: Mở / Khởi động cùng Windows / Thoát.
- Khởi động cùng Windows dùng `app.setLoginItemSettings({openAtLogin, args: ['--hidden']})`.

## 9. Xử lý lỗi và edge case

| Tình huống | Xử lý |
|---|---|
| 401 từ LLM | "Token sai hoặc hết hạn", kèm link sang Settings |
| 429 / 5xx | SDK `openai` tự retry 2 lần (`maxRetries`) |
| Mất mạng giữa stream | Giữ phần đã stream, đánh dấu lỗi, hiện nút Thử lại |
| Tool lỗi (zod, SQL) | Trả `{error}` về model để tự sửa, vẫn tính vào 8 vòng |
| `query_readonly_sql` có lệnh ghi | Connection `readOnly` từ chối, trả lỗi |
| Pending action sau khi restart | Vẫn còn trong DB, card vẫn xác nhận được |
| Bản ghi đích đã đổi/xóa khi xác nhận | Báo lỗi rõ ràng, không ghi |
| Ảnh không phải image hoặc > 20MB | Chặn ở renderer |
| Model không hỗ trợ vision | Hiện lỗi rõ ràng từ API, gợi ý đổi model |
| "Mai", "thứ 6 tuần sau" | System prompt có ngày hiện tại. Card hiển thị ngày tuyệt đối để user kiểm tra |

## 10. Testing

- **Vitest** + `node:sqlite` in-memory:
  - từng tool: schema, SQL, "hôm nay", ngày kế tiếp của `recurrence`, FTS không dấu, `readOnly` từ chối ghi.
- **Agent loop** với fake LLM trả `tool_calls` theo kịch bản:
  - đọc thì tự chạy; ghi thì thành pending;
  - xác nhận thì chạy tiếp; hủy thì model nhận đã hủy;
  - dừng ở 8 vòng.
- **Thủ công:**
  - checklist smoke test với endpoint thật;
  - script ~20 câu tiếng Việt kiểm tra model chọn đúng tool.

## 11. Rủi ro

- `node:sqlite` vẫn là experimental trong Node 22. API có thể đổi khi nâng Electron. Toàn bộ truy cập DB đi qua `src/main/db/` nên nếu phải đổi driver thì chỉ sửa một chỗ.
- Chất lượng hiểu tiếng Việt và cách chọn tool phụ thuộc model. Bước xác nhận là lưới an toàn cho thao tác ghi.
- Ảnh được gửi lên endpoint LLM. User cần chấp nhận điều này với ảnh nhạy cảm.

## 12. Ý tưởng để sau (ngoài MVP)

- Tự động tóm tắt buổi sáng và tổng kết cuối ngày.
- Thói quen (habit) và mục tiêu, báo cáo tuần.
- Subtask, view lịch tuần/tháng, biểu đồ chi tiêu.
- Tìm kiếm ngữ nghĩa (embeddings).
- Expose tools qua MCP.
