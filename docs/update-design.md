# Báo có bản mới và tự cập nhật trong app đã đóng gói — thiết kế

Ngày: 2026-10-01. Liên quan: `docs/release-design.md`, `.github/workflows/release.yml`, `src/main/settings.ts`.

## Tóm tắt

- App kiểm tra GitHub Releases xem có phiên bản mới hơn bản đang chạy không. Có thì hiện banner "Tải về / Bỏ qua bản này"; Settings có mục "Cập nhật" với phiên bản hiện tại, nút kiểm tra thủ công và công tắc tự kiểm tra.
- Lý do: bản đóng gói không có cách nào biết có bản mới; người dùng phải tự vào GitHub xem.
- Cho: chủ dự án và những người tải bản về từ README, trên Windows, macOS, Linux (kể cả bản portable và macOS chưa ký).
- Ràng buộc: không ký mã, không đổi pipeline build, không thêm dependency.
- Ngoài phạm vi: tự tải và tự cài (`electron-updater`), kiểm tra chữ ký/checksum, hiện release notes, timer nền, toast của hệ điều hành, kênh beta/pre-release.

## Giả định

1. Nguồn: `GET https://api.github.com/repos/TienThuan29/personal-assistant/releases/latest`. Repo công khai nên không cần token; hạn mức 60 request/giờ/IP là dư. Endpoint tự loại draft và pre-release.
2. So sánh semver ba số, bỏ tiền tố `v`. Chỉ báo khi bản trên GitHub **lớn hơn** `app.getVersion()`.
3. Gọi từ main bằng `net.fetch` (đi qua proxy TLS công ty như phần LLM). CSP renderer giữ `connect-src 'self'`. Timeout 10 giây.
4. Kiểm tra tự động thất bại thì im lặng; kiểm tra thủ công thì báo lỗi.
5. Quyền riêng tư: một request GET tới api.github.com, không gửi dữ liệu người dùng, không telemetry.
6. Quy trình phát hành không đổi: tăng `version`, gắn tag `vX.Y.Z`, CI tạo Release. Cơ chế này chỉ đọc kết quả.
7. Kiểm tra chạy sau khi cửa sổ đã hiện, không chặn khởi động.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| U1 | Chỉ báo có bản mới và mở trang tải | Tự tải và cài bằng `electron-updater`; kết hợp cả hai | `electron-updater` trên macOS cần app đã ký, bản portable không tự thay được, cần sinh thêm `latest*.yml` trong CI. Báo + mở trang chạy được mọi nơi, không đổi build |
| U2 | Kiểm tra khi mở app (tối đa 1 lần/24 giờ) và nút thủ công | Chỉ thủ công; thêm timer 6 giờ | App chạy ở khay nên 1 lần/ngày là đủ; không cần timer nền |
| U3 | Banner trong app + mục Settings | Chỉ Settings; thêm toast hệ điều hành | Toast không đồng đều (portable không có AUMID); chỉ Settings thì dễ bỏ lỡ |
| U4 | Nút "Tải về" mở trang Release | Mở thẳng file đúng hệ điều hành | Windows có hai bản (portable, setup) nên phải đoán; trang Release để người dùng tự chọn |
| U5 | Logic ở main (`src/main/update.ts`), renderer chỉ hiển thị | Renderer quyết định, main chỉ proxy fetch; `electron-updater` chế độ chỉ kiểm tra | Giữ quyền mạng trong main với một URL cố định, dễ test bằng `fetch` giả. Phương án thứ hai mở quyền fetch URL tuỳ ý cho renderer; phương án thứ ba thêm dependency và `latest.yml` chỉ để làm việc một `fetch` làm được |
| U6 | Trạng thái nằm trong một dòng `update` của bảng `settings`: `{ checkedAt, found, skipped }`; không có trạng thái trong bộ nhớ | Giữ kết quả trong bộ nhớ main và đẩy event | Reload renderer không mất banner, không đua với lúc cửa sổ mở |
| U7 | Renderer gọi `check(false)` khi mount; không có timer ở main | Main tự lên lịch rồi push event | Không cần lịch, không có race giữa event và lúc renderer sẵn sàng |
| U8 | Công tắc `ui.checkUpdates` (mặc định `true`) trong `UiSettings` | Khoá riêng trong `settings` | Dùng lại `setUi`, `ui:changed`, `SettingsView` |
| U9 | Một đường tắt banner duy nhất: "Bỏ qua bản này" (nhớ phiên bản); không có nút × | Thêm × chỉ ẩn trong phiên | Hai kiểu "tắt" với nghĩa khác nhau là thừa; bản kế tiếp vẫn báo |
| U10 | Link tự dựng từ tag đã qua regex `^v\d+\.\d+\.\d+$`, không dùng `html_url` | Mở `html_url` của phản hồi | Phản hồi không được quyết định URL được mở; sai nhất cũng chỉ là sai số phiên bản |
| U11 | Thất bại tự động không ghi `checkedAt` | Ghi để không thử lại trong 24 giờ | Lần mở app sau thử lại; mỗi lần chạy chỉ một request nên không có vòng lặp |

## Thiết kế

### `src/main/update.ts` (mới)

- `REPO = 'TienThuan29/personal-assistant'` là hằng, không thành cấu hình.
- `isNewer(latest, current)`: tách ba số, so từng số; chuỗi không đúng dạng thì `false`.
- `checkForUpdate(db, { fetch, version, now, manual })` trả `{ current, latest: string | null, url: string | null }`. `latest` khác `null` khi có bản mới hơn `version`.
  - Tự động (`manual = false`): công tắc tắt thì trả `latest = null` mà không gọi mạng. Nếu `0 <= now - checkedAt < 24h` thì không gọi mạng, chỉ trả `found` đã lưu khi vẫn mới hơn `version` và khác `skipped`. Ngược lại gọi GitHub, ghi `checkedAt` và `found`, trả kết quả (đã loại `skipped`). Lỗi thì trả `latest = null`, không ghi `checkedAt`.
  - Thủ công: luôn gọi mạng, bỏ qua giới hạn 24 giờ và `skipped`. Lỗi ném `UserError('updateFailed')`.
- `skipVersion(db, version)` ghi `skipped`.
- Phản hồi chỉ dùng `tag_name`; `url = https://github.com/${REPO}/releases/tag/${tag}`.

### IPC và renderer

- `update:check(manual)` và `update:skip(version)` trong `ipc.ts`, `preload/index.ts`, `Api` ở `shared/types.ts`. `SettingsView` thêm `version: string`; `UiSettings` thêm `checkUpdates: boolean` (schema zod, `DEFAULT_UI.checkUpdates = true`).
- `useUpdate` trong `App.tsx` gọi `api.update.check(false)` khi mount và giữ kết quả cho banner. Banner dùng `Alert` của Arco, hiện trên mọi trang: "Có phiên bản X (bạn đang dùng Y)" với **Tải về** (mở `url` qua `shell.openExternal`) và **Bỏ qua bản này**.
- `SettingsPage.tsx`: `SectionCard` "Cập nhật" trước "Hệ thống", gồm dòng Phiên bản (số phiên bản, nút Kiểm tra cập nhật, kết quả ngay cạnh: bản mới nhất / có bản X kèm Tải về / không kiểm tra được; nút loading khi đang chạy) và dòng công tắc "Tự kiểm tra khi mở app".
- Chuỗi mới ở `shared/locales/{vi,en}.ts`, lỗi `errors.updateFailed`.

### Lỗi và trường hợp biên

- Lỗi quy về "không kiểm tra được": offline, quá 10 giây, HTTP khác 200 (403 hết hạn mức, 404 chưa có Release), JSON lạ, `tag_name` không khớp regex.
- `current >= latest` (bản dev, chạy trước tag) thì không báo. `found` đã cài thì tự hết vì luôn so lại với `app.getVersion()`. Đã bỏ qua 0.1.2 nhưng ra 0.1.3 thì báo lại. `checkedAt` ở tương lai thì coi là quá hạn. Pre-release và draft không bao giờ xuất hiện.

### Kiểm thử

- `tests/update.test.ts` với `fetch` giả và DB thật: bảng `isNewer`; công tắc tắt thì không gọi mạng; trong 24 giờ dùng `found` không fetch; quá hạn thì fetch lại và ghi `checkedAt`; lỗi tự động im lặng và không ghi `checkedAt`; lỗi thủ công ném; bỏ qua bản này; URL dựng từ tag, không từ `html_url`.
- `tests/seed-demo.test.ts` hoặc công cụ chụp ảnh dựng trạng thái "có bản mới" để chụp banner và Settings.
- Kiểm tra thật bằng probe Electron: gọi API GitHub thật, phiên bản giả 0.1.0, khi Release v0.1.1 đã có.
- `docs/smoke-test.md` thêm mục "Cập nhật"; README thêm một dòng; `docs/release-design.md` sửa "tự cập nhật" từ ngoài phạm vi thành "kiểm tra và báo, xem `docs/update-design.md`".

## Rủi ro đã nhận

- Người dùng vẫn phải tự tải và cài. Với bản portable và macOS chưa ký, đó là giới hạn của việc không ký mã.
- Dựa vào repo công khai và API không cần token; repo chuyển riêng tư hoặc đổi tên thì phải sửa `REPO`.
- Hạn mức 60 request/giờ/IP có thể hết sau proxy dùng chung; kiểm tra tự động im lặng bỏ qua, thủ công báo lỗi.

## Tự cập nhật (phần mở rộng, cùng ngày)

Sau khi làm phần báo bản mới, người dùng hỏi có thêm tự cập nhật được không. Phạm vi: **Windows installer (NSIS) và Linux AppImage**. Windows portable và macOS vẫn chỉ có banner "Tải về" (portable không tự thay mình được; Squirrel.Mac từ chối bản ký ad-hoc, cần Apple Developer). Bản 0.1.1 đã phát hành chưa có updater, nên người dùng 0.1.1 phải cài tay bản đầu tiên có updater một lần.

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| U12 | Tự cập nhật cho Windows installer + Linux AppImage; phần còn lại giữ banner | Chỉ Windows; thêm macOS (ký + notarize) | Hai bản này chạy được với `electron-updater` mà không cần chứng chỉ; macOS tốn phí hằng năm và cần bí mật trong CI |
| U13 | Người dùng bấm "Cập nhật và khởi động lại" mới tải (có phần trăm), xong tự thoát, cài im lặng và mở lại | Tải ngầm rồi hỏi khởi động lại | Không tải ~100 MB ngầm, không bất ngờ, không thêm trạng thái "đã tải xong" |
| U14 | `update.ts` vẫn là nguồn duy nhất cho "có bản mới không"; `electron-updater` chỉ tải và cài khi bấm (`src/main/selfupdate.ts`) | Dùng `electron-updater` cho cả việc kiểm tra | Không có hai bộ kiểm tra; giữ giới hạn một lần/ngày, "bỏ qua", test sẵn có |
| U15 | `canInstall` = đã đóng gói và (Windows không có `PORTABLE_EXECUTABLE_FILE`, hoặc Linux có `APPIMAGE`); đi kèm `UpdateStatus` | Hỏi `electron-updater` | Quyết định ở một chỗ, test được; renderer chỉ chọn nút |
| U16 | Mọi lỗi (offline, thiếu `latest.yml`, SHA-512 sai, AppImage không ghi được, không có bản mới) → toast `installFailed`, nút đổi về "Tải về" | Hiện lỗi chi tiết; thử lại tự động | Một đường lui đơn giản, luôn có cách tự cập nhật bằng tay |
| U17 | `electron-updater` là devDependency được bundle như mọi dependency; `publish: github` trong `electron-builder.yml`; CI tải thêm `latest*.yml` và `*.blockmap` | Đóng gói `node_modules`; dùng `generic` provider | Giữ quy ước "chỉ ship `out/`"; GitHub Release đã là nơi phát hành, repo công khai nên không cần token |

Rủi ro đã nhận: bản installer không ký, nên không có kiểm tra chữ ký, chỉ có SHA-512 trong `latest.yml`; niềm tin dựa vào tài khoản GitHub chứa repo, như khi tải tay. Thẻ Settings vẫn mở trang Release khi thấy bản mới (cài tự động chỉ ở banner). macOS và Linux chỉ có CI smoke test, chưa chạy thật.

## Đã làm

- `src/main/update.ts` + `tests/update.test.ts` (22 test), `ui.checkUpdates` trong `UiSettings`, IPC `update:check` / `update:skip`, `SettingsView.version`, banner trong `App.tsx`, thẻ "Cập nhật" trong `SettingsPage.tsx`, chuỗi `vi`/`en`, mục "Update notice" trong `docs/smoke-test.md`, mục "Updating" trong README.
- Đã kiểm tra thật bằng app Electron: nút "Kiểm tra cập nhật" gọi GitHub thật và báo "Bạn đang dùng bản mới nhất" khi Release mới nhất là v0.1.1; banner chụp với trạng thái đã lưu `found: 0.1.2`.
- Chưa kiểm tra: toàn bộ luồng với hai Release thật (cần phát hành bản sau 0.1.1), "Bỏ qua bản này" bằng click thật (chỉ có test đơn vị).
- Tự cập nhật: `src/main/selfupdate.ts` + `tests/selfupdate.test.ts` (10 test, `autoUpdater` giả), IPC `update:install` / sự kiện `update:progress`, `UpdateStatus.canInstall`, nút trong banner, `publish` trong `electron-builder.yml`, CI tải `latest*.yml` + `*.blockmap`.
- Đã kiểm tra trên bản đóng gói thật (`release/win-unpacked`, thư mục dữ liệu tạm): `bun run pack` sinh `latest.yml` (chỉ liệt kê installer) và `app-update.yml`; `electron-updater` nằm trong `out/main/index.js`, app khởi động bình thường; `canInstall` là true; bấm nút → "Đang tải 0%" → lỗi (Release v0.1.1 chưa có `latest.yml`) → banner về "Tải về". **Chưa** kiểm tra tải và cài thành công: cần Release có `latest.yml` (0.1.2) rồi một Release nữa (0.1.3).
