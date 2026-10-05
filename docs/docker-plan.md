# Kế hoạch: Docker mode

Thiết kế: `docs/docker-design.md` (D1–D16). Mỗi task: implementer → review spec → review chất lượng → commit. Task 0 dựng stage test trong Docker, Task 1 là refactor thuần: bản Electron phải chạy y như cũ.

## Quy ước chung

- **KHÔNG chạy Electron trên máy này** (người dùng cấm, 2026-10-05; máy công ty phạt tiến trình lạ): không `bun run dev`, không `bun run test` (nó chạy electron.exe), không screenshot/CDP, không mở exe. Subagent cũng vậy; phải ghi rõ trong prompt.
- Kiểm tra mọi thứ trong Docker: `docker build --target test -t pa-test .` chạy `bun run typecheck` và vitest trên **Node 22 thuần** (cùng Node với Electron 37, Task 0). Test nào cần Electron thật (ví dụ `tests/icon.test.ts` import `electron`) sẽ lỗi trong container: báo lại, loại khỏi lần chạy container bằng `--exclude` và để CI (job `check`) chạy chúng. Trên host chỉ dùng `git`, `docker` và sửa file.
- Code và comment tiếng Anh, giống văn phong hiện có. Chuỗi UI qua i18next: key mới thêm vào **cả** `src/shared/locales/vi.ts` và `en.ts` (`tests/i18n.test.ts` kiểm tra đủ key).
- Không đổi tool, prompt, schema của bot. Không động vào dữ liệu thật ở `%APPDATA%/personal-assistant`. Không `taskkill /IM electron.exe`.
- Commit `feat(docker): …` / `refactor(main): …`, kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Quy tắc import: mọi file trong `src/main/` trừ `index.ts`, `icon.ts`, `ipc-desktop.ts` **không được import `electron` hay `electron-updater`**. `src/server/` cũng vậy. Server bundle bằng esbuild, nên một import `electron` lọt vào sẽ được bundle im lặng (package `electron` chỉ export đường dẫn binary) và vỡ lúc chạy. Task 5 có test chặn điều này.
- Địa chỉ ảnh: GitHub `TienThuan29/personal-assistant` (xem `src/main/update.ts`) → image `ghcr.io/tienthuan29/personal-assistant` (chữ thường).

## Task 0: Stage `test` trong Docker (để kiểm tra không cần Electron)

**File:** mới `Dockerfile` (mới có stage `deps`, `test`; Task 6 thêm `build` và runtime), `.dockerignore`.

```dockerfile
FROM node:22-slim AS deps
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json bun.lock ./
COPY vendor/ vendor/
RUN bun install --frozen-lockfile

FROM deps AS test
COPY . .
RUN bun run typecheck && node node_modules/vitest/vitest.mjs run
```

`.dockerignore`: `node_modules`, `out`, `release`, `.git`, `*.db`, `docker/certs/*.crt`. Kiểm tra: `docker build --target test -t pa-test .` chạy được trên mã hiện tại. Ghi lại test nào lỗi vì cần Electron (dự kiến chỉ `icon.test.ts`; loại chúng bằng tham số `--exclude` ở dòng cuối nếu cần, và nói rõ trong commit). Nếu `bun install` trong container lỗi vì `@aionui/ui` hay postinstall, sửa trong stage này. Commit `build(docker): test stage`.

## Task 1: Tách `ipc.ts` thành lõi không phụ thuộc Electron (Electron chạy y như cũ)

**File:** mới `src/main/bootstrap.ts`, `src/main/ipc-desktop.ts`; sửa `src/main/ipc.ts`, `src/main/index.ts`.

1. `bootstrap.ts` — hàm `openData(dataDir, now)` dùng chung cho Electron và server, gom đoạn đầu `start()` trong `index.ts` (`mkdirSync` attachments, `openDb`, `setLanguage(getUi(db).language)`, `ro = new DatabaseSync(dbPath, { readOnly: true })`, `backupDb` trong try/catch, `pruneEmptyConversations`, `cleanupOrphans`). Trả `{ db, ro, dbPath, attachmentsDir }`. `index.ts` gọi hàm này thay cho đoạn cũ.
2. `MainCtx` (trong `ipc.ts`) thêm các trường và `registerIpc` chỉ dùng chúng, không import `electron`/`electron-updater`:

   ```ts
   handle: (channel: string, fn: (...args: any[]) => unknown) => void;
   toJpeg: (bytes: unknown) => Buffer;        // Electron: nativeImage; server: validate-only (Task 3)
   fetch: typeof fetch;                       // Electron: net.fetch; server: global fetch
   home: string;                              // app.getPath('home')
   version: string;                           // app.getVersion()
   fileSearch: boolean;                       // false on the server: chat:send rejects files === true
   canInstall: () => boolean;                 // canSelfUpdate(...) on desktop, () => false on the server
   ```

   Trong thân hàm: `ipcMain.handle('x', (_e, a) => …)` → `m.handle('x', (a) => …)` (bỏ tham số `_e`); `netFetch` → `m.fetch`; `app.getPath('home')` → `m.home`; `app.getVersion()` → `m.version`; `toJpeg(...)` → `m.toJpeg(...)`; `canInstall()` → `m.canInstall()`. Trong `chat:send`, nếu `files === true && !m.fileSearch` ném `new UserError('notAllowed', { name: 'files' })` trước khi lưu gì.
3. `ipc-desktop.ts` (giữ import `electron`, `electron-updater`): `registerDesktopIpc(m, deps)` đăng ký `files:reveal` (đang dùng `shell.showItemInFolder`), `update:install` (đang dùng `installUpdate(autoUpdater…)`), `settings:setOpenAtLogin`; đồng thời export `toJpeg` (đoạn `nativeImage` hiện ở đầu `ipc.ts`, kèm `MAX_IMAGE_BYTES`/`MAX_SIDE`) và `desktopCanInstall`. Chuyển nguyên văn các handler đó, không đổi hành vi. `index.ts` gọi `registerIpc({...,handle: (c, f) => ipcMain.handle(c, (_e, ...a) => f(...a)), toJpeg, fetch: net.fetch as typeof fetch, home: app.getPath('home'), version: app.getVersion(), fileSearch: true, canInstall})` rồi `registerDesktopIpc`.
4. Kiểm tra: `grep -rn "from 'electron" src/main src/shared` chỉ còn `index.ts`, `icon.ts`, `ipc-desktop.ts`.
5. `docker build --target test -t pa-test .` xanh (typecheck + vitest). Không chạy app Electron; việc desktop không đổi được bảo đảm bằng review diff (handler chuyển nguyên văn) và typecheck.

## Task 2: Auth và HTTP server (có test)

**File:** mới `src/server/auth.ts`, `src/server/http.ts`, `tests/server-auth.test.ts`.

1. `auth.ts`:

   ```ts
   export function loadToken(env: NodeJS.ProcessEnv, file: string): string; // PA_TOKEN, else the file, else randomBytes(24).toString('base64url') written 0600
   export const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
   export const hostOk = (host?: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? '');
   export const originOk = (origin?: string, host?: string) => origin === undefined || (host !== undefined && origin === `http://${host}`);
   export const cookieHeader = (token: string) => `pa_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
   export function readCookie(header: string | undefined, name: string): string | undefined;
   ```

2. `http.ts` — `createApp(opts): http.Server` với `opts = { token, rendererDir, handlers: Map<string, fn>, attachment: (id) => {path, mime} | undefined, events: { add(res), … } }`. Không tự `listen`. Thứ tự xử lý mỗi request:
   - Host sai → 403. `POST` mà Origin sai → 403.
   - `GET /` có `?token=<đúng>` → `Set-Cookie` + `302 /`.
   - Chưa có cookie đúng: `/rpc/*`, `/events`, `/att/*` → 401; mọi route khác → 401 kèm một dòng text hướng dẫn "mở URL có token trong `docker logs`".
   - `POST /rpc/<channel>`: đọc body tối đa 32 MB (vượt → 413 và hủy kết nối), `JSON.parse(body, reviver)` với reviver đổi `{"$b64": "..."}` thành `Buffer`; channel không có trong `handlers` → 404 `{ok:false,error}`; gọi `await fn(...args)` → `{ok:true,value}`; lỗi → `{ok:false,error: errMsg(e)}` (dùng `errMsg` trong `src/main/errors.ts`, đã i18n `UserError`), HTTP 200 để shim phân biệt lỗi ứng dụng với lỗi mạng.
   - `GET /events` (SSE): header `text/event-stream`, `res.write(': ok\n\n')`, thêm vào tập kết nối, bỏ khi `close`. `send(channel, payload)` ghi `data: ${JSON.stringify({channel,payload})}\n\n` cho mọi kết nối; heartbeat `: ping` mỗi 25 s.
   - `GET /att/<id>` → `attachment(id)` (trả `res` file với `content-type`) hoặc 404.
   - Còn lại: file tĩnh trong `rendererDir` (chặn `..`, MIME theo đuôi, `index.html` mặc định; không có file thì 404).
3. `tests/server-auth.test.ts` (listen port 0, thư mục renderer tạm): 401 không cookie, 403 sai Host (`fetch` với header `host` tùy chỉnh bằng `http.request`), 403 sai Origin, `?token=` → Set-Cookie + 302, token sai → 401, `loadToken` sinh một lần rồi đọc lại, 413 body quá lớn, `$b64` được giải mã thành `Uint8Array`.

## Task 3: Entry server và test round trip

**File:** mới `src/server/index.ts`, `tests/server.test.ts`.

1. `src/server/index.ts` (không dùng `electron`): đọc env `PA_DATA_DIR` (mặc định `./data`), `PORT` (3000), `PA_TOKEN`. Rồi:
   - `openData(dataDir, now)` (Task 1);
   - `cipher`: `createCipher({ isEncryptionAvailable: () => false, encryptString() { throw new Error('unreachable') }, decryptString() { throw new Error('unreachable') } }, join(dataDir, 'secrets.key'))` — nhánh AES-GCM có sẵn, D5;
   - `handlers = new Map()`; `send` = SSE broadcast của `createApp`; `scheduler = createScheduler({ db, now, notify: (rows) => { send('reminder', rows); send('data:changed'); } })`;
   - `registerIpc({ db, ro, attachmentsDir, secretsFile: join(dataDir, 'secrets.bin'), cipher, send, loginItem: { get: () => false, set() {} }, onDataChanged: () => { scheduler.refresh(); send('data:changed'); }, handle: (c, f) => handlers.set(c, f), toJpeg: validateJpeg, fetch, home: homedir(), version, fileSearch: false, canInstall: () => false })`;
   - `validateJpeg(bytes)`: `Uint8Array`, ≤ 20 MB, bắt đầu bằng `FF D8 FF`, ngược lại `UserError('imageType')` (ảnh đã được trình duyệt encode, Task 4);
   - `attachment`: `attachmentFile(db, attachmentsDir, id)`;
   - `listen(PORT, '0.0.0.0')` (container; port chỉ được map ra `127.0.0.1` bởi compose), in `http://localhost:${PORT}/?token=${token}` ra log;
   - `scheduler.refresh()`; SIGTERM/SIGINT → `scheduler.stop()`, `server.closeAllConnections()`, `server.close()`, `db.close()`, `ro.close()`, `process.exit(0)`.
2. Tách phần dựng thành `export function startServer(opts): Promise<{ server, port, close }>` để test gọi được; file chỉ gọi `startServer` khi chạy trực tiếp. `version` lấy từ `__APP_VERSION__` do esbuild `define` (Task 5), mặc định `'dev'`.
3. `tests/server.test.ts` (data dir tạm, port 0, token cố định): token → cookie → `POST /rpc/conv:create` rồi `conv:list` thấy conv đó; SSE (`fetch` đọc stream) nhận `data:changed` sau `data:save`; `chat:send` với `files:true` bị từ chối; ảnh không phải JPEG bị từ chối bởi `data:save`; `/att/<id>` có cookie trả ảnh còn không cookie thì 401; `settings:save` với `apiKey` → `settings:get` báo `hasKey`, và `secrets.bin`/`secrets.key` nằm trong data dir, `secrets.bin` không chứa chuỗi key; `update:check` trả `canInstall:false`.

## Task 4: Phía trình duyệt: shim `window.api` và UI

**File:** mới `src/renderer/web-api.ts`, `src/renderer/notify.ts`, `tests/web-api.test.ts`; sửa `src/shared/types.ts`, `src/preload/index.ts`, `src/renderer/api.ts`, `src/renderer/App.tsx`, `src/renderer/pages/SettingsPage.tsx`, `src/renderer/components/*` (chỉ `attUrl`), locales vi/en.

1. `types.ts`: `Api` thêm `web: boolean` và `onReminder(cb: (rows: ReminderRow[]) => void): () => void`. `preload/index.ts`: `web: false`, `onReminder: listen('reminder')`.
2. `web-api.ts` — `createWebApi(deps = { fetch, EventSource, reload: () => location.reload() }): Api`:
   - `invoke(channel, ...args)`: `POST /rpc/${channel}` JSON `{args}` với `Uint8Array` → `{$b64}`; `ok:false` → `throw new Error(error)`; HTTP 401 → `throw new Error('Unauthorized: open the URL with the token printed in docker logs')`.
   - `listen(channel)`: một `EventSource('/events')` dùng chung, bộ phân phối theo `channel`. Khi `onerror` rồi `onopen` lần nữa (kết nối lại, kể cả sau khi container restart để update) → `deps.reload()`: tải lại từ DB, và lấy luôn JS mới sau update (D15). Mất bản nháp đang gõ chấp nhận được.
   - `chat.send` / `data.save`: trước khi gửi, ảnh qua `toJpeg(images)` (D11): `createImageBitmap(new Blob([bytes]))` → `OffscreenCanvas` với cạnh dài ≤ 1568 → `convertToBlob({ type: 'image/jpeg', quality: 0.85 })` → `Uint8Array`. Không test được trong Node, kiểm tay ở smoke test.
   - Chức năng chỉ có trên desktop: `files.reveal` và `update.install` reject `Error('Not available in the browser')`, `settings.setOpenAtLogin` → `false`, `win.*` no-op (`isMaximized` → `false`), `update.onProgress` / `win.onMaximizedChange` / `onNavigate` / `onUiChanged` vẫn là `listen`, `web: true`.
3. `api.ts`: `export const api = (window as unknown as { api?: Api }).api ?? createWebApi();`; `attUrl = (id) => (api.web ? `/att/${id}` : `att://${id}`)`.
4. `App.tsx`: ẩn `WindowControls` khi `api.web`; trong banner update, khi `api.web` thay nút bằng chữ `t('update.docker')` ("Chạy `docker compose pull` rồi `up -d`", bỏ nút Tải về/Cài); thêm `api.onReminder` vào mảng `offs` nếu `api.web`, gọi `showReminders(rows, t, () => go('today'))`.
5. `notify.ts` — `showReminders(rows, t, onClick)`: nếu `typeof Notification === 'undefined' || Notification.permission !== 'granted'` thì bỏ qua; ngược lại `new Notification(title, { body: rows.map(r => `• ${r.message}`).join('\n') })`, `onclick` → `window.focus(); onClick(); n.close()`. Tiêu đề lấy cùng chuỗi với `system:reminder(s)` trong main (kiểm tra namespace có dùng được ở renderer; nếu không, thêm key vào `common`/`settings` ở cả vi/en).
6. `SettingsPage.tsx`: khi `api.web` ẩn hàng `openAtLogin`, ẩn khối cập nhật tự động nếu có nút cài, và thêm một hàng "Thông báo trình duyệt" với nút `Notification.requestPermission()` hiển thị trạng thái hiện tại (`default`/`granted`/`denied`).
7. `SendBox.tsx`: khi `api.web` không hiện nút bật "files" (`files` luôn `false`).
8. `tests/web-api.test.ts` (fetch và EventSource giả): `invoke` trả `value`; `ok:false` → `Error` đúng message; `Uint8Array` được mã hóa `$b64`; sự kiện SSE đến đúng listener theo channel; kết nối lại gọi `reload` đúng một lần; hủy đăng ký thì hết nhận.
9. `docker build --target test -t pa-test .` xanh. Không chạy Electron: kiểm desktop bằng review (`WindowControls` còn khi `api.web` là `false`, `attUrl` vẫn `att://`).

## Task 5: Build server và chặn lọt `electron`

**File:** mới `scripts/build-server.mjs`, `tests/server-bundle.test.ts`; sửa `package.json`, `.gitignore` (không cần: `out/` đã ignore).

1. `bun add -d esbuild` (đúng bản đang nằm trong cây của vite, để khóa phiên bản).
2. `scripts/build-server.mjs`:

   ```js
   import { build } from 'esbuild';
   import { readFileSync } from 'node:fs';
   const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
   await build({
     entryPoints: ['src/server/index.ts'],
     bundle: true, platform: 'node', format: 'esm', target: 'node22',
     outfile: 'out/server/index.js',
     external: ['node:sqlite'], // too new for esbuild's builtin list
     define: { __APP_VERSION__: JSON.stringify(version) },
     banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
   });
   ```

3. `package.json`: `"build:server": "node scripts/build-server.mjs"`, `"build:web": "electron-vite build && node scripts/build-server.mjs"`.
4. `tests/server-bundle.test.ts`: `esbuild.build({ ..., write: false, metafile: true })` cùng cấu hình; khẳng định không input nào có đường dẫn chứa `node_modules/electron` hay `electron-updater`, và `src/main/index.ts`, `icon.ts`, `ipc-desktop.ts` không nằm trong đồ thị.
5. **Kiểm tra giả định (D9):** `ELECTRON_SKIP_BINARY_DOWNLOAD=1` rồi `bun install` trong thư mục sạch và `bunx electron-vite build` có chạy được không. Nếu không, thêm `vite.web.config.ts` chỉ build renderer (root `src/renderer`, plugin UnoCSS như trong `electron.vite.config.ts`, `build.outDir: ../../out/renderer`) và đổi `build:web` thành `vite build -c vite.web.config.ts && node scripts/build-server.mjs`.
6. Chạy thử trong Docker (Task 6 có image): `docker run` với `PA_TOKEN=dev`, mở `http://localhost:3000/?token=dev` bằng Chrome, bấm thử các trang, tạo task, mở Settings. Kiểm tra CSP trong `index.html` không chặn SSE và `/att` (`connect-src 'self'` phủ `EventSource` cùng origin, `img-src 'self'` phủ `/att/…`); nếu trình duyệt báo vi phạm thì sửa meta CSP.

## Task 6: Dockerfile và compose

**File:** sửa `Dockerfile` (Task 0), mới `docker/docker-compose.yml`, `docker/docker-compose.certs.yml`, `docker/update.ps1`, `docker/certs/.gitkeep`; sửa `.gitignore`.

1. `Dockerfile` — giữ stage `deps`/`test` của Task 0, thêm `build` (từ `deps`) và runtime:

   ```dockerfile
   FROM deps AS build
   COPY . .
   RUN bun run build:web

   FROM node:22-slim
   ENV NODE_ENV=production PA_DATA_DIR=/data PORT=3000
   WORKDIR /app
   COPY --from=build /src/out/server ./server
   COPY --from=build /src/out/renderer ./renderer
   RUN mkdir /data && chown node:node /data
   USER node
   VOLUME /data
   EXPOSE 3000
   CMD ["node", "server/index.js"]
   ```

   Server tìm renderer ở `new URL('../renderer', import.meta.url)` (khớp cả `out/server`→`out/renderer` và `/app/server`→`/app/renderer`).
2. `.dockerignore`: thêm `docs` (không ignore `tests`: stage `test` cần chúng).
3. `docker/docker-compose.yml`:

   ```yaml
   name: personal-assistant
   services:
     assistant:
       image: ghcr.io/tienthuan29/personal-assistant:latest
       restart: unless-stopped
       ports: ['127.0.0.1:${PA_PORT:-3000}:3000']
       environment:
         TZ: ${TZ:-Asia/Ho_Chi_Minh}
       volumes: [pa-data:/data]
   volumes:
     pa-data:
   ```

   `docker/docker-compose.certs.yml`: cùng service, thêm `volumes: ['./certs/zscaler-root-ca.crt:/certs/ca.crt:ro']` và `environment: { NODE_EXTRA_CA_CERTS: /certs/ca.crt }`. `.gitignore`: `docker/certs/*.crt` (giữ `.gitkeep`). Người dùng copy `zscaler-root-ca.crt` vào `docker/certs/`.
4. `docker/update.ps1`: `$ErrorActionPreference='Stop'; Set-Location $PSScriptRoot`; dựng `$files = @('-f','docker-compose.yml')`, thêm `-f docker-compose.certs.yml` nếu `docker/certs/zscaler-root-ca.crt` tồn tại; `docker compose @files pull`; `docker compose @files up -d`; rồi in dòng URL: `docker compose @files logs --tail 30 assistant | Select-String 'token='`.
5. Kiểm tra cục bộ (Docker Desktop có sẵn): `docker build -t pa-test .`; chạy `docker run --rm -p 127.0.0.1:3000:3000 -e TZ=Asia/Ho_Chi_Minh -v pa-test-data:/data pa-test`; lấy URL từ log; `curl` không cookie → 401; mở bằng URL có token; `docker run --rm -e TZ=Asia/Ho_Chi_Minh pa-test node -e "console.log(new Date().getTimezoneOffset())"` ra `-420`; `docker stop` thoát sạch trong < 10 s (SIGTERM); dừng rồi chạy lại cùng volume giữ dữ liệu. Với cert: `docker compose -f docker/docker-compose.yml -f docker/docker-compose.certs.yml up` (image local qua `image:` tạm đổi hoặc `--build`), vào Settings → "Kiểm tra kết nối" với LLM thật qua Zscaler.

## Task 7: CI

**File:** sửa `.github/workflows/release.yml`.

Thêm job `docker`, phụ thuộc `check`, cùng điều kiện với `build` (`workflow_dispatch` hoặc `publish == 'true'`), quyền `contents: read, packages: write`. Checkout `ref: ${{ needs.check.outputs.sha }}` như job `build`; `docker/setup-buildx-action@v3`; `docker/login-action@v3` (chỉ khi `publish == 'true'`, `registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`); bước tính tên image chữ thường (`echo "name=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"`); `docker/build-push-action@v6` với `context: .`, `platforms: linux/amd64`, `push: ${{ needs.check.outputs.publish == 'true' }}`, `tags` là `<name>:${{ needs.check.outputs.tag }}` và `<name>:latest`, `labels: org.opencontainers.image.source=https://github.com/${{ github.repository }}`, `cache-from/to: type=gha`. Chạy tay (`workflow_dispatch`): build, không push. Sau lần push đầu: GitHub → Packages → personal-assistant → Package settings → Change visibility → Public (một lần).

## Task 8: Tài liệu và dọn

1. `README.md`: mục "Docker" (ngắn): yêu cầu, copy cert vào `docker/certs/`, `docker compose -f docker/docker-compose.yml [-f docker/docker-compose.certs.yml] up -d`, lấy URL token từ `docker compose logs`, update bằng `docker/update.ps1`, dữ liệu nằm trên volume `pa-data` (sao lưu: `docker cp`), giới hạn của Docker mode (không file search, reminder chỉ khi tab mở).
2. `docs/smoke-test.md`: thêm mục Docker (build, token, LLM thật qua cert, chọn ảnh → JPEG, Web Notification cho reminder, restart giữ dữ liệu, `update.ps1`).
3. `docs/docker-design.md`: thêm mục "Đã làm" (As built) ghi mọi chỗ lệch kế hoạch.
4. Cập nhật memory `personal-assistant-app.md` (trạng thái, commit).
