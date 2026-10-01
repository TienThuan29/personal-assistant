# Biểu tượng ứng dụng — thiết kế

Ngày: 2026-10-01. Liên quan: `electron-builder.yml`, `docs/smoke-test.md` (Reminders and tray).

## Tóm tắt

- Dùng bộ biểu tượng có sẵn trong `assets/app-icons/` (bong bóng chat trắng + hình người trên nền xanh dương chuyển sắc) làm biểu tượng ứng dụng.
- Hiển thị ở mọi nơi, cả đóng gói lẫn `bun run dev`: cửa sổ, thanh tác vụ, khay hệ thống, trình cài đặt/gỡ cài đặt, file `.exe` đã cài, lối tắt Start menu.
- Hiện tại mọi nơi đều hiện biểu tượng mặc định của Electron: cửa sổ không có `icon`, khay đọc biểu tượng từ chính `.exe`, và `signAndEditExecutable: false` khiến electron-builder không ghi biểu tượng vào `.exe`.
- Dùng đúng file `personal-assistant.ico` (6 khung: 16, 32, 48, 64, 128, 256). SVG và PNG giữ trong repo nhưng không dùng lúc chạy.
- Không đổi: hành vi ứng dụng, AUMID (toast nhắc nhở), dữ liệu.
- Ngoài phạm vi: logo trong sidebar/header, đổi màu biểu tượng theo màu chủ đạo (biểu tượng luôn xanh), biểu tượng macOS/Linux, phụ thuộc mới.

## Giả định

- Chỉ Windows. `.ico` đã đủ khung cho khay (16/32), thanh tác vụ và trình cài đặt.
- Các file trong `assets/app-icons/` là của người dùng và được commit nguyên trạng.
- Windows lưu đệm biểu tượng: lối tắt đã ghim có thể hiện biểu tượng cũ tới khi gỡ ghim/ghim lại hoặc làm mới bộ nhớ đệm.
- Hiệu năng, quy mô, bảo mật không bị ảnh hưởng; thêm ~41 KB vào gói.
- Không tự động kiểm tra được thanh tác vụ và khay; có bước thủ công trong smoke test.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| I1 | Biểu tượng ở mọi nơi, cả dev lẫn đóng gói | Chỉ bản đóng gói; chỉ cửa sổ và khay | Người dùng chọn |
| I2 | `afterPack` ghi biểu tượng vào `.exe` bằng rcedit có sẵn trong `node_modules` | Bật `signAndEditExecutable`; bỏ qua `.exe` | Không tải winCodeSign (proxy TLS chặn); lối tắt Start menu và thanh tác vụ lấy biểu tượng từ `.exe` |
| I3 | `import …?asset` + `asarUnpack`; cửa sổ dùng `icon`, khay dùng `nativeImage` | `extraResources` + rẽ nhánh theo `isPackaged`; khay lấy từ `.exe` | Một đường dẫn duy nhất cho dev và đóng gói |
| I4 | Dùng `.ico` nguyên trạng, không logo trong UI, không đổi màu | Logo trong sidebar; biểu tượng theo màu chủ đạo | Người dùng xác nhận; YAGNI |

## Thiết kế

### 1. Biểu tượng lúc chạy — `src/main/icon.ts`

- `import iconPath from '../../assets/app-icons/personal-assistant.ico?asset'` (electron-vite 5 có sẵn; chép file vào `out/main/` và trả đường dẫn đúng ở dev lẫn đóng gói; cần `/// <reference types="electron-vite/node" />` cho kiểu).
- Xuất `appIcon = nativeImage.createFromPath(iconPath)`. Rỗng (`isEmpty()`) → `console.warn` một dòng; cửa sổ rơi về biểu tượng mặc định, khay trống, ứng dụng vẫn chạy.
- `createWindow()` thêm `icon: appIcon`.
- `createTray()` dùng `appIcon` thay `app.getFileIcon(process.execPath, …)`; Windows chọn khung 16/32 theo DPI. Hàm không còn cần `async` vì biểu tượng.
- `electron-builder.yml`: `asarUnpack: out/main/*.ico` — API biểu tượng gốc của Electron không đọc được trong asar.

### 2. Lúc build

- `win.icon: assets/app-icons/personal-assistant.ico` — biểu tượng trình cài đặt, gỡ cài đặt, mục Apps & features (NSIS; không cần rcedit).
- `scripts/stamp-icon.cjs` làm `afterPack` (`afterPack: scripts/stamp-icon.cjs`): `execFileSync('node_modules/electron-winstaller/vendor/rcedit.exe', [<appOutDir>/Personal Assistant.exe, '--set-icon', <ico>])`. Lỗi hoặc thiếu `rcedit.exe` thì ném lỗi, `bun run pack` dừng, không bao giờ ra `.exe` mang biểu tượng mặc định một cách âm thầm.
- `signAndEditExecutable: false` giữ nguyên (không tải winCodeSign). Lối tắt NSIS lấy biểu tượng từ `.exe` đã cài nên được sửa theo; AUMID không đổi.
- Rủi ro: `rcedit.exe` là phụ thuộc bắc cầu (electron-builder → squirrel-windows → electron-winstaller). Nếu nâng cấp làm mất, hook báo lỗi rõ; khi đó `bun add -d rcedit` và đổi một dòng đường dẫn. rcedit chỉ ghi biểu tượng, không đụng metadata khác (đã vậy sẵn vì `signAndEditExecutable: false`).

### 3. Kiểm thử và tài liệu

- `tests/icon.test.ts` (chạy trên Node của Electron): `personal-assistant.ico` tồn tại và header có các khung 16, 32, 256. Không test `icon.ts` (hai dòng, `?asset` chỉ chạy dưới bundler).
- `bun run pack`, rồi kiểm tra: `.exe` có tài nguyên biểu tượng (trích ra, so với `.ico`); `release/win-unpacked/resources/app.asar.unpacked/out/main/*.ico` tồn tại; trình cài đặt build được.
- Ảnh chụp bằng hook `PA_SCREENSHOT` trên profile nháp để kiểm tra cửa sổ; thanh tác vụ và khay kiểm thủ công.
- `docs/smoke-test.md`: hai bước — biểu tượng ở trình cài đặt, Start menu, thanh tác vụ, khay; làm mới bộ nhớ đệm biểu tượng nếu còn hiện cái cũ.
- Commit `assets/app-icons/`; cập nhật ghi nhớ của dự án.

## As built

- `createTray()` giữ nguyên `async` (chỉ đổi nguồn biểu tượng) để khỏi sửa nơi gọi; `.catch` ở `start()` vẫn bảo vệ.
- `?asset` ghi file vào `out/main/chunks/personal-assistant-<hash>.ico`, nên `asarUnpack` là `out/**/*.ico`.
- `afterPack` chạy sau khi electron-builder in "executable resource editing … skipped"; đã kiểm tra bằng cách trích biểu tượng từ `.exe` và trình cài đặt (cả hai ra biểu tượng mới), và bản đóng gói khởi động bình thường sau khi ghi.
- electron-builder gợi ý `signExecutable: false` thay cho `signAndEditExecutable: false` (vẫn sửa biểu tượng/metadata, chỉ bỏ ký); cách đó cũng cần winCodeSign nên không dùng.
- Chưa kiểm tự động: thanh tác vụ, khay, lối tắt Start menu (bước thủ công trong smoke test).
