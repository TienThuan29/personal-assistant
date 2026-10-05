# Docker mode: thiết kế

Ngày: 2026-10-05. Trạng thái: đã làm (xem "Đã làm" ở cuối). Kế hoạch: `docs/docker-plan.md` (8 task).

## Hiểu yêu cầu

- Thêm **một chế độ chạy thứ hai**: Docker container chạy backend và phục vụ UI qua trình duyệt tại `http://localhost:PORT`. Bản Electron giữ nguyên, hai chế độ dùng chung agent, tools, store và renderer React.
- Lý do: máy công ty phạt nếu có tiến trình `PersonalAssistant.exe` chạy ngầm. Docker/WSL đã được công ty cho phép (người dùng xác nhận).
- Người dùng: một người, một container, dữ liệu nhỏ (SQLite + ảnh).
- Docker mode: reminder bằng Web Notification khi tab đang mở; tìm file cục bộ tắt; API key nhập trong Settings, lưu trên volume; truy cập bằng token.
- **Không làm:** nhiều người dùng/truy cập từ xa, nhắc việc khi đã đóng tab (Telegram/email), reveal-in-Explorer, tray/open-at-login/titlebar tùy biến, self-update trong container, nút update gọi Docker (cần `docker.sock`), Electron trong container qua VNC, arm64.

## Giả định

1. Docker Desktop.exe/vmmem cũng là tiến trình nền; đã được phép, không kiểm tra thêm.
2. Công ty dùng Zscaler (TLS inspection). `net.fetch` của Electron dùng kho chứng chỉ Windows, Node trong container thì không: cần CA gốc `zscaler-root-ca.crt` (người dùng đã có) mount lúc chạy. Không bao giờ tắt verify TLS.
3. `docker pull` từ ghcr.io qua Zscaler chạy được (project `swovn-aic-backend` kéo `mcr.microsoft.com` qua cùng proxy). Chưa kiểm chứng với ghcr.
4. Dùng tab Chrome/Edge (có thể "Install as app").
5. Tính năng desktop không đổi; Docker mode không có cửa sổ riêng.

## Decision Log

| # | Quyết định | Đã cân nhắc | Lý do |
|---|---|---|---|
| D1 | Docker là **option thêm**, không thay Electron | Thay hẳn bằng web | Người dùng chỉ hỏi "thêm 1 option"; mac/Linux/Windows build đã phát hành |
| D2 | Hướng A: thêm lớp transport web, giữ lõi (`handle` registry + HTTP + SSE + `window.api` shim) | B: Electron trong container qua Xvfb + noVNC; C: fork bản web | B nặng (~1 GB+), gõ tiếng Việt/dán ảnh qua VNC kém, vẫn không có toast; C hai codebase sẽ lệch nhau |
| D3 | Reminder: Web Notification khi tab mở (nút "Bật thông báo" trong Settings xin quyền); reminder bắn khi không có tab vẫn chuyển `fired` như hiện nay | Chỉ trong app; gửi Telegram/email | Ít việc nhất, đúng lựa chọn của người dùng |
| D4 | File search (`find_files`/`grep_files`/`read_file`) **tắt** trong Docker mode; server từ chối `files: true`, nút ẩn | Mount một thư mục host chỉ-đọc | Không mount gì từ host: an toàn, ít code; thêm sau được |
| D5 | API key nhập trong Settings, lưu trên volume, **dùng lại `createCipher`** với `safeStorage` giả báo `isEncryptionAvailable() === false` → nhánh AES-256-GCM có sẵn (key trong `secrets.key`, 0600) | Plaintext file 0600 (đã chọn lúc đầu); AES-GCM + master key từ env | Mức an toàn thực tế như plaintext (key và ciphertext cùng volume) nhưng không phải viết nhánh mới, và file không đọc được bằng mắt. Đổi so với lựa chọn plaintext ban đầu, người dùng đã duyệt ở phần 2 |
| D6 | Truy cập: port chỉ map `127.0.0.1`; token (`PA_TOKEN` hoặc sinh một lần, lưu trên volume, in vào log); cookie `HttpOnly; SameSite=Strict`; kiểm tra Host (`localhost`/`127.0.0.1`) và Origin | Chỉ Host/Origin, không token | App giữ key LLM và dữ liệu cá nhân; chặn DNS-rebinding/CSRF và tiến trình khác trên máy |
| D7 | Cert Zscaler **mount lúc chạy** (`docker-compose.certs.yml` + `NODE_EXTRA_CA_CERTS`); `certs/` chỉ commit `.gitkeep`, `*.crt` gitignore | Bake vào image như `swovn-aic-backend` | Image build trên GitHub Actions không có cert; một image dùng chung mọi máy. File override riêng để máy không dùng Zscaler không bị Docker tạo nhầm thư mục thay file |
| D8 | Update = `docker compose pull && up -d` (script `update.ps1`); volume giữ dữ liệu, migration tự chạy. Banner "có bản mới" vẫn hiện nhưng chỉ chỉ lệnh | `docker exec` vào container rồi update; mount `docker.sock` cho nút trong app | Container bất biến, sửa trong container mất khi tạo lại; `docker.sock` cho container quyền điều khiển Docker của máy |
| D9 | Image: `esbuild` bundle `src/server/index.ts` → `out/server/index.js` (nhúng mọi package), runtime `node:22-slim`, user `node`, **named volume** `/data` (không bind-mount NTFS) | Node 24; copy `node_modules`; bind-mount thư mục Windows | Node 22 khớp Electron 37 nơi test chạy; bundle thì runtime không cần `node_modules`; khóa file SQLite trên NTFS/virtiofs không đáng tin |
| D10 | CI: thêm job `docker` vào `release.yml` (sau `check`, cùng tag), push `ghcr.io/<owner>/personal-assistant:{version,latest}` `linux/amd64`; `workflow_dispatch` chỉ build; package đặt **Public** (đổi tay một lần sau lần push đầu) | Registry private + `docker login`; thêm arm64 | Không cần đăng nhập khi pull; image chỉ chứa code, không chứa key/dữ liệu |
| D11 | Ảnh đính kèm resize/encode JPEG (≤1568px) **ở trình duyệt** bằng canvas; server chỉ kiểm tra magic bytes JPEG và dung lượng | `sharp` ở server | Không thêm thư viện native vào image |
| D12 | `registerIpc` nhận `handle(channel, fn)` qua `MainCtx` thay vì gọi `ipcMain` trực tiếp; thêm `toJpeg`, `fetch`, `home`, `version` vào `MainCtx` | Server tự import handler riêng | Một nơi đăng ký handler, Electron và server không lệch |
| D13 | Compose đặt `TZ: ${TZ:-Asia/Ho_Chi_Minh}` | Để UTC | App tính "hôm nay" và giờ nhắc theo giờ local; UTC lệch 7 giờ |
| D14 | Kênh sự kiện server→trình duyệt dùng **SSE** (`GET /events`, `EventSource`), không dùng WebSocket | WebSocket (thư viện `ws`) | Chỉ cần một chiều (lệnh đi qua POST); `EventSource` có sẵn trong trình duyệt, tự reconnect, đi cùng cookie, không thêm dependency. Đổi so với bản thiết kế đầu |
| D15 | Khi SSE kết nối lại, shim `location.reload()` | Phát `data:changed` giả rồi để từng màn tự tải lại | Sự kiện stream chat rơi lúc mất kết nối; reload lấy lại từ DB và (sau khi container restart để update) lấy luôn JS mới. Mất bản nháp đang gõ: chấp nhận |
| D16 | `ipc.ts` thành lõi không import `electron` (handler chỉ dành cho desktop sang `ipc-desktop.ts`); `bootstrap.ts` dùng chung cho Electron và server | Server tự viết lại phần mở DB | Dùng lại một nơi; esbuild sẽ nhúng im lặng package `electron` nếu lỡ import, nên có test chặn (Task 5) |

## Thiết kế

### 1. Kiến trúc và transport

- `ipc.ts` đăng ký ~25 handler bằng `ipcMain.handle`; đổi thành `m.handle(channel, fn)`. Electron truyền `(c, f) => ipcMain.handle(c, (_e, ...a) => f(...a))`, hành vi không đổi. Handler chỉ có ở desktop (`files:reveal`, `update:install`, `settings:setOpenAtLogin`, `win:*`) không được server đăng ký.
- `src/server/index.ts` (entry mới): mở DB, backup/prune/cleanup như `start()`, tạo scheduler, dựng HTTP server; `handle` ghi vào `Map<channel, fn>`.
- Giao thức: `POST /rpc/<channel>` body `{args:[…]}` → `{ok,value}` | `{ok:false,error}` (ảnh dạng base64 trong JSON); `GET /events` (SSE, xem D14) đẩy `{channel,payload}` cho `chat:event`, `data:changed`, `ui:changed`, `nav`, `reminder`, broadcast mọi tab; `GET /att/<id>` thay scheme `att://` (renderer: `attUrl` theo chế độ); static phục vụ `out/renderer`.
- Trình duyệt: `src/renderer/web-api.ts` dựng `window.api` đúng type `Api` từ `invoke`/`listen`; chỉ nạp khi preload không cấp `window.api`. Thêm `onReminder` (tùy chọn) vào `Api`.

### 2. Thay phụ thuộc Electron và bảo mật

- `net.fetch` → `fetch` của Node (`createLlm` đã nhận `{fetch}`), CA qua `NODE_EXTRA_CA_CERTS`.
- `nativeImage` → dep `toJpeg` (D11). `app.getPath('home')`, `app.getVersion()` → `MainCtx` (version từ `package.json`).
- Reminder: `notify(rows)` ở server broadcast `reminder` + `data:changed`; shim hiện Web Notification, click → focus tab, `nav: today`.
- Tắt: file search, titlebar tùy biến, tray, open-at-login, self-update (banner chỉ trỏ lệnh `docker compose pull`).
- Bảo mật: D6. Giữ nguyên mọi validate `UserError` hiện có; server không tin gì từ body.

### 3. Đóng gói, CI, update

- `electron-vite build` cho renderer; `esbuild` cho server (`--external:node:sqlite`). Dockerfile nhiều stage: build (`bun install --frozen-lockfile`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`) → runtime `node:22-slim`.
- `docker-compose.yml`: `127.0.0.1:3000:3000`, volume `pa-data:/data`, `restart: unless-stopped`, `TZ`. `docker-compose.certs.yml`: mount `./certs/zscaler-root-ca.crt:/certs/ca.crt:ro` + `NODE_EXTRA_CA_CERTS=/certs/ca.crt`.
- CI: D10. `update.ps1`: `docker compose -f … pull` rồi `up -d`.

### 4. Lỗi, trường hợp biên, test

- Chưa xác thực → 401 (trang `/` hiện hướng dẫn mở URL có token trong `docker logs`); sai Host/Origin → 403; body > 32 MB → 413. Ảnh vẫn tối đa 10 ảnh, 20 MB mỗi ảnh.
- `EventSource` tự reconnect; khi kết nối lại shim gọi `location.reload()` (D15) vì sự kiện stream của chat đang chạy lúc mất kết nối đã rơi.
- SIGTERM: dừng scheduler, đóng server, `close()` DB (checkpoint WAL) trong 10 s của `docker stop`.
- Test: 139 test hiện có xanh sau refactor; test server mới (port ngẫu nhiên, data tạm): 401 không cookie, 403 sai Host/Origin, token → cookie → RPC `conv:create`/`conv:list`, SSE nhận `data:changed` sau `data:save`, từ chối ảnh không phải JPEG, từ chối `files:true`, `/att` có cookie trả ảnh, 413, `TZ` trong image. Smoke thủ công thêm vào `docs/smoke-test.md`: build + chạy, chat LLM thật qua cert Zscaler, Web Notification, restart giữ dữ liệu, `update.ps1`.

## Rủi ro đã ghi nhận

- Image CI và chạy qua Zscaler chưa kiểm chứng đến khi chạy thật trên máy người dùng.
- Cần kiểm tra ở bước plan: `electron-vite build` chạy được khi bỏ tải binary Electron; CSP trong `index.html` (`connect-src 'self'`, `img-src 'self'`) cho phép SSE và `/att` cùng origin.
- Package ghcr phải chuyển Public bằng tay một lần.
- Docker Desktop vẫn là tiến trình nền (đã được người dùng chấp nhận).

## Đã làm (As built)

Trạng thái 2026-10-05: Task 0–8 của `docs/docker-plan.md` đã làm và commit (`22a280a`..`f4e1dbe` + tài liệu). Kiểm tra bằng container, không bao giờ chạy Electron trên máy này (người dùng cấm).

- **Kiểm tra:** `docker build --target test -t pa-test .` chạy `bun run typecheck` và vitest trên Node 22 thuần, `--exclude tests/smoke.test.ts` (nó khẳng định đang chạy trong Electron; job `check` của CI vẫn chạy) và `--testTimeout 30000` (`tests/db.test.ts` quá 5 s khi laptop bận). Kết quả cuối: 332 test pass, 21 skipped (eval LLM và seed, opt-in).
- **Khác kế hoạch:**
  - `src/server/` tách `server.ts` (`startServer`, `validateJpeg`, test gọi được) khỏi `index.ts` (đọc env, in URL, SIGTERM).
  - `scripts/server-build.config.mjs` tách khỏi `scripts/build-server.mjs` để `tests/server-bundle.test.ts` dùng cùng cấu hình esbuild. `esbuild` thêm vào devDependencies chỉ bằng một dòng trong `bun.lock` (gói đã có sẵn qua vite).
  - Compose nhận `PA_IMAGE` (ghim bản hoặc thử image local) và `PA_PUBLIC_PORT` (chỉ để URL trong log hiện đúng cổng đã publish).
  - Stage `deps` cài `ca-certificates` bằng apt (`node:22-slim` không có `update-ca-certificates`) rồi tin `docker/certs/*.crt`; stage runtime không chứa cert.
  - `settings:test`, `update:check` v.v. chạy nguyên văn qua `registerIpc`; chỉ `files:reveal`, `update:install`, `settings:setOpenAtLogin` là desktop-only (`src/main/ipc-desktop.ts`).
- **Đã xác nhận bằng chạy thật (Docker Desktop):** image build (`electron-vite build` chạy được khi bỏ tải binary Electron), 401 không cookie, 403 sai Host và sai Origin, `?token=` → cookie + 302, RPC `conv:create`/`data:save`, `docker stop` mất ~2 s và thoát mã 0, dữ liệu và token còn sau restart, user `node`, `TZ=Asia/Ho_Chi_Minh` cho offset -420, compose chạy với và không có file certs.
- **Chưa xác nhận:**
  - Giao diện trong trình duyệt thật (CSP với SSE và `/att`, nén ảnh bằng canvas, Web Notification): extension Chrome không kết nối được lúc làm; nằm trong mục Docker của `docs/smoke-test.md`.
  - Cert Zscaler: từ trong container thấy chứng chỉ công khai thật (Sectigo, Google Trust Services), nghĩa là trên mạng lúc đó lưu lượng của Docker không bị chặn TLS, nên chưa chứng minh được cert override là cần. Nó có sẵn cho mạng công ty, và `bun install` trong build cũng chạy với CA được tin. Cần thử với gateway LLM thật.
  - Job `docker` trong `release.yml` (YAML hợp lệ, chưa chạy): lần chạy đầu trên GitHub, rồi đặt package ghcr thành Public một lần. Chưa kiểm chứng `docker pull` từ ghcr qua Zscaler.
