# Đóng gói đa nền tảng và phát hành — thiết kế

Ngày: 2026-10-01. Liên quan: `electron-builder.yml`, `docs/app-icon-design.md`, `docs/smoke-test.md`.

## Tóm tắt

- Đóng gói personal-assistant thành bản **chạy ngay, không cài** cho ba hệ điều hành, viết README và gắn link tải.
  - Windows: `.exe` portable **và** trình cài đặt NSIS hiện có (portable không có lối tắt Start menu mang AUMID nên toast nhắc nhở có thể không hiện).
  - macOS: file zip chứa `Personal Assistant.app` (arm64 và x64). Không dùng `.dmg`.
  - Linux: AppImage x64.
- GitHub Actions build cả ba khi đẩy tag `vX.Y.Z` rồi tạo một GitHub Release; README link tới file mới nhất của Release.
- Hiện chưa có remote git, chưa có CI, chưa có README; máy này là Windows nên không build được macOS/Linux cục bộ.
- Không đổi hành vi ứng dụng cho macOS/Linux; giới hạn ghi trong README.
- Ngoài phạm vi: ký mã / notarize, tự tải và tự cài bản mới (chỉ báo có bản mới: `docs/update-design.md`), `.dmg`/`.deb`/`.rpm`, ARM Linux/Windows, sửa tray/toast/keyring/khung cửa sổ cho macOS và Linux.

## Giả định

1. File phát hành: Windows x64 portable + setup, macOS arm64 + x64, Linux x64 AppImage; mỗi file khoảng 90–120 MB.
2. Bản không ký: Windows hiện cảnh báo SmartScreen; macOS chặn tới khi chuột phải → Open (hoặc `xattr -cr`); Linux cần `chmod +x` và FUSE; Ubuntu 24.04+ có thể cần `--no-sandbox`. README ghi hết.
3. Giới hạn ghi trong README: portable không có toast; Linux không mã hoá được API key khi thiếu keyring và một số desktop không có tray; điều khiển cửa sổ kiểu Windows trên macOS/Linux; chữ "khởi động cùng Windows" chỉ đúng với Windows.
4. Kích hoạt: đẩy tag `v*` → build + publish; `workflow_dispatch` → build, chỉ tải artifact, không publish. Tag phải khớp `version` trong `package.json`.
5. CI chạy typecheck và test một lần trên Linux trước khi build.
6. Repo công khai (Release của repo riêng tư không tải được khi chưa đăng nhập). README dùng link tương đối nên không cần biết owner/tên repo.
7. Không có bí mật trong repo (API key nằm trong thư mục dữ liệu của người dùng).
8. Người dùng tự tăng version và gắn tag khi phát hành. README viết bằng tiếng Anh.
9. Không kiểm chứng được macOS/Linux ở máy này; lần chạy CI đầu là phép thử và có thể cần chỉnh.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| R1 | GitHub Releases + Actions | Host khác; chỉ build cục bộ | Người dùng chọn; macOS chỉ build được trên runner macOS |
| R2 | Chỉ build + ghi giới hạn, không sửa hành vi | Sửa các blocker; port đầy đủ | Không có máy macOS/Linux để kiểm chứng; người dùng chọn |
| R3 | Windows: portable + giữ trình cài đặt | Chỉ portable; chỉ installer | Toast nhắc nhở cần lối tắt AUMID do NSIS tạo |
| R4 | Một job `release` tạo Release từ artifact của job build (`gh release create`) | Mỗi job tự publish; action bên thứ ba | Tạo một lần, không đua; lỗi một OS thì không ra Release dở; ít phụ thuộc cho pipeline có quyền ghi |
| R5 | `electronDist` chuyển khỏi YAML vào script `pack` cục bộ | Giữ trong YAML | Chỉ cần ở máy này (proxy TLS); CI tải Electron bình thường |
| R6 | Tên file không kèm version (`PersonalAssistant-win-x64-portable.exe`…) | Có version trong tên | Link `releases/latest/download/<tên>` luôn trỏ bản mới nhất, README không phải sửa mỗi lần phát hành |
| R7 | `stamp-icon.cjs` chỉ chạy trên Windows | Chạy mọi nơi | rcedit.exe là file Windows |

## Thiết kế

### 1. Cấu hình build

- `win.target: [portable, nsis]` (x64); tên `PersonalAssistant-win-x64-portable.exe` và `PersonalAssistant-win-x64-setup.exe` (`portable.artifactName`, `nsis.artifactName`). Giữ hook ghi biểu tượng.
- `mac.target: zip` (arm64 + x64, một lần chạy trên runner macOS), tên `PersonalAssistant-mac-<arch>.zip`; biểu tượng từ `icon-1024.png` (electron-builder tự đổi sang icns).
- `linux.target: AppImage` (x64), tên `PersonalAssistant-linux-x64.AppImage`; biểu tượng từ `icon-512.png`.
- Script: `pack:win`, `pack:mac`, `pack:linux` (build rồi `electron-builder --publish never` cho đúng OS); `pack` cục bộ giữ nguyên và truyền `-c.electronDist=node_modules/electron/dist`.
- `scripts/stamp-icon.cjs` thoát sớm khi không phải `win32`.
- Rủi ro chưa kiểm chứng: macOS arm64 cần chữ ký ad-hoc tối thiểu để chạy (electron-builder thường tự làm khi không có chứng chỉ; không được thì ghi `xattr -cr`); AppImage trên Ubuntu 24.04+ có thể bị chặn bởi sandbox của kernel.

### 2. Workflow — `.github/workflows/release.yml`

- Kích hoạt: tag `v*` và `workflow_dispatch`.
- `check` (ubuntu): checkout, setup-bun, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`; khi chạy bằng tag thì fail nếu tag khác version trong `package.json`.
- `build` (ma trận windows/macos/ubuntu, `needs: check`, `fail-fast: false`): cài đặt, `pack:<os>`, `upload-artifact` các file `release/*.exe|*.zip|*.AppImage`. Job Linux chạy thử bản giải nén vài giây dưới `xvfb-run` và fail nếu thoát lỗi (kiểm chứng runtime duy nhất ngoài Windows).
- `release` (ubuntu, `needs: build`, chỉ khi chạy bằng tag, `permissions: contents: write` — job duy nhất có quyền ghi): tải mọi artifact, `gh release create "$TAG" <files> --title "$TAG" --generate-notes`. Chạy lại cùng tag sẽ lỗi thay vì ghi đè; muốn làm lại thì xoá Release và tag.
- Các action chính thức ghim theo bản chính (`actions/checkout@v4`…). Miễn phí cho repo công khai; mỗi file nhỏ hơn nhiều so với giới hạn 2 GB.

### 3. README, quy trình phát hành, kiểm chứng

- README (tiếng Anh): mô tả hai dòng; bảng tải với link trực tiếp tương đối (`../../releases/latest/download/<tên>`) cho Windows portable/installer, macOS Apple Silicon/Intel, Linux; mục "Run it" theo OS (SmartScreen "Run anyway", macOS chuột phải → Open hoặc `xattr -cr`, Linux `chmod +x` + ghi chú `--no-sandbox`); thiết lập lần đầu (thêm LLM endpoint trong Cài đặt); giới hạn đã biết; vị trí dữ liệu theo OS; build từ mã nguồn (`bun install`, `bun run dev`, `bun run pack:<os>`); phát hành (tăng version, tag `vX.Y.Z`, push).
- Thiết lập repo (người dùng tự làm vì đưa mã ra ngoài): tạo repo công khai trên GitHub, `git remote add origin …`, `git push -u origin master --tags`. Link README chỉ hoạt động sau khi có Release đầu tiên.
- Kiểm chứng được ở máy này: `bun run pack:win` ra đủ portable và setup, portable khởi động; đọc kỹ YAML của workflow. Chỉ CI kiểm chứng được macOS/Linux: sau khi push, chạy workflow thủ công một lần (chỉ artifact), dự kiến có chỉnh sửa, chủ yếu về chữ ký macOS.
- Tài liệu: tài liệu này (thêm "As built" sau khi làm) và một dòng trong `docs/smoke-test.md` cho bản portable.

## As built

- `mac.identity: '-'` + `hardenedRuntime: false` (ad-hoc ký): trong electron-builder 26, khi không có chứng chỉ thì **bỏ qua ký hoàn toàn, không tự ký ad-hoc**, có thể làm app arm64 không chạy; vì vậy ký ad-hoc được bật rõ ràng. Chưa kiểm chứng (cần runner macOS).
- `pack` cục bộ nay chạy `--win` (ra cả portable và setup) với `-c.electronDist`; `pack:win|mac|linux` không có `electronDist`.
- Bản portable cục bộ khởi động bình thường (mất ~30 s lần đầu vì tự giải nén); setup đổi tên thành `PersonalAssistant-win-x64-setup.exe` (trước là `PersonalAssistant-Setup-0.1.0.exe`).
- Smoke test Linux trong CI chạy AppImage với `--appimage-extract-and-run --no-sandbox` dưới `xvfb-run`, đòi vẫn còn chạy sau 25 s và có `assistant.db`.
- `check` dùng `bun run test` trên Ubuntu; chưa biết test nào phụ thuộc Windows (grep không thấy), CI sẽ cho biết.
- Workflow và `electron-builder.yml` đã parse được bằng js-yaml; chưa chạy trên GitHub.
