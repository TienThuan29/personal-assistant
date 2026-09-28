# Song ngữ vi/en: Design

Ngày: 2026-09-28 · Trạng thái: đã duyệt (brainstorming)

## 1. Understanding summary

- Thêm cài đặt ngôn ngữ giao diện **Tiếng Việt / English**. Mặc định là Tiếng Việt. Đổi xong áp dụng **ngay**, không cần khởi động lại.
- **Phạm vi dịch:** mọi chữ người dùng nhìn thấy:
  - renderer (sider, các trang, thẻ xác nhận, SendBox, mô tả slash command, thông báo trống, dialog);
  - locale Arco và nhãn `@aionui/ui`;
  - lỗi từ main (LLM, validate, tool);
  - menu tray, toast nhắc nhở, tiêu đề hội thoại mặc định.
- **Giữ nguyên:** system prompt và mô tả tool gửi LLM. Bot vẫn trả lời theo ngôn ngữ người dùng gõ.
- **Ngày giờ:** định dạng số cố định `dd/mm/yyyy HH:mm` (locale vi-VN) cho cả hai ngôn ngữ. Chữ bao quanh thì dịch: T2/Mon, "Hằng tuần"/"Weekly".
- **Tiền tệ, hai cài đặt riêng:**
  - kiểu hiển thị: `vi` ("55.000 ₫") hoặc `intl` ("₫55,000");
  - **tiền tệ mặc định** (VND, USD…): dùng cho `create_expense` và luật tiền trong system prompt.
- **Non-goals:**
  - ngôn ngữ thứ 3;
  - dịch dữ liệu đã lưu (tiêu đề task, category người dùng tự nhập, lịch sử chat, lỗi đã ghi trên thẻ);
  - đổi ngôn ngữ trả lời của LLM.

## 2. Assumptions

1. Lỗi tool hiện trên thẻ xác nhận theo ngôn ngữ đang chọn. LLM nhận cùng câu đó và đọc được cả hai ngôn ngữ.
2. Tên slash command (`/homnay`, `/tuannay`, `/chitieu`) giữ nguyên. Mô tả và prompt soạn sẵn thì đổi theo ngôn ngữ.
3. Key category có sẵn `work`/`personal` hiển thị theo ngôn ngữ. Category người dùng tự nhập giữ nguyên chữ.
4. `defaultCurrency` là mã ISO 4217 gồm 3 chữ A–Z. Đổi tiền tệ mặc định không động đến khoản chi đã có.
5. Hiệu năng và quy mô không đổi. Setting nằm trong bảng `settings` hiện có và không phải bí mật.
6. Có test bảo đảm vi và en có cùng bộ key và cùng placeholder.

## 3. Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| L1 | `i18next` + `react-i18next`. Resource là object TS (`src/shared/locales/{vi,en}.ts`), khai báo `CustomTypeOptions` để có kiểu | Từ điển tự viết | Người dùng chọn. Là chuẩn phổ biến, vẫn giữ type-check key |
| L2 | Dịch UI và thông điệp hệ thống. Prompt và tool giữ nguyên | Dịch luôn cả prompt; chỉ dịch renderer | Người dùng chọn |
| L3 | Mặc định vi, áp dụng ngay qua broadcast `ui:changed` | Theo ngôn ngữ Windows; phải restart | Người dùng chọn |
| L4 | Ngày giờ chỉ một định dạng số `dd/mm/yyyy HH:mm`; chữ đi kèm được dịch | Định dạng theo ngôn ngữ; ISO | Người dùng chọn |
| L5 | Tiền: `moneyStyle` và `defaultCurrency` là hai cài đặt riêng | Định dạng tiền theo ngôn ngữ | Người dùng chọn |
| L6 | Tool và zod ném **mã lỗi** (`UserError(key, params)` hoặc message là key). Main dịch trong `parseArgs`/`errMsg` theo ngôn ngữ hiện tại | Giữ câu tiếng Việt cứng | Một nguồn cho lỗi trên thẻ và lỗi gửi LLM |
| L7 | Không dịch lại lịch sử. Tiêu đề hội thoại còn là giá trị mặc định thì hiển thị bằng nhãn đã dịch | Migration dữ liệu | Đơn giản, không đụng vào dữ liệu |

## 4. Kiến trúc

- **Namespaces:** `common`, `chat`, `pages`, `settings`, `errors`, `system`. `en.ts` khai kiểu `typeof vi`, nên thiếu key là lỗi build.
- **Renderer:**
  - Instance i18n khởi tạo với ngôn ngữ lấy từ `settings:get` **trước** lần render đầu tiên.
  - Component dùng `useTranslation()`.
  - Nhận `ui:changed` thì gọi `i18n.changeLanguage`, đổi locale Arco (`viVN`/`enUS`), đổi bộ nhãn `UiProvider` và đổi `moneyStyle` trong context.
- **Main:** một instance riêng (`createInstance`). Dùng cho `describeLlmError`, lỗi validate IPC, `UserError` và zod message trong tool, menu tray, toast nhắc nhở.
- **Lưu trữ:** key `ui` trong `settings` = `{ language: 'vi'|'en', moneyStyle: 'vi'|'intl', defaultCurrency: string }`, mặc định `{vi, vi, VND}`, validate bằng zod.
- **IPC:**
  - `settings:get` trả thêm `ui`.
  - `settings:setUi(patch)`: merge, validate, lưu, đổi ngôn ngữ của main, broadcast `ui:changed`.
- **Tiền:**
  - `formatMoney(amount, currency, style)` dùng locale `vi-VN` hoặc `en-US`.
  - `ToolCtx.settings()` cung cấp `defaultCurrency` cho `create_expense`.
  - `systemPrompt` ghi rõ tiền tệ mặc định.
- **Ngày:** giữ `toLocaleString('vi-VN', …)`. `recurrenceText(rule, t)` và nhãn thứ trong tuần đi qua `t`.

## 5. Edge cases

- Lịch sử, lỗi đã lưu trên thẻ và tiêu đề hội thoại đã đặt không đổi theo ngôn ngữ.
- Không nhấp nháy ngôn ngữ lúc khởi động, vì ngôn ngữ được đọc trước lần render đầu.
- Thiếu key thì fallback về `vi`. Test ngăn trường hợp này xảy ra.
- Menu tray dựng lại mỗi lần mở. Toast dùng ngôn ngữ tại thời điểm nó bắn.

## 6. Kiểm thử

- Test parity key và placeholder giữa vi và en.
- `formatMoney` với 2 kiểu hiển thị.
- `recurrenceText` với 2 ngôn ngữ.
- Lỗi tool và lỗi zod được dịch theo ngôn ngữ của main.
- Validate `setUi`.
- `create_expense` dùng tiền tệ mặc định; prompt chứa tiền tệ mặc định.
- Screenshot các trang ở cả en và vi. Đổi ngôn ngữ lúc app đang chạy.
