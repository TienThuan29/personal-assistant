# PDF theo batch, preview từng trang và stream reasoning: Design

Ngày: 2026-10-05 · Trạng thái: đã duyệt qua brainstorming (phần Edge case và Test được gộp thẳng vào tài liệu này, không trình bày riêng), đang implement

Hai việc cùng nằm trong một thay đổi vì cùng nhắm vào "chờ lâu mà không thấy gì":

1. User đính kèm **PDF**: app vẽ từng trang thành ảnh, đưa cho model như ảnh hiện nay, **chia batch 10 trang** xử lý tuần tự, có tiến độ, và có **viewer xem từng trang**.
2. **Hiển thị thinking**: stream nội dung reasoning cho **LM Studio**, và đồng hồ giây reset theo từng bước (đồng hồ giây cơ bản đã có sẵn trong `ThoughtDisplay` của `@aionui/ui`).

Branch xếp trên `feat/lm-studio-provider` (PR #13), vì reasoning cần provider LM Studio.

---

## 1. Understanding summary

- Chỉ hỗ trợ PDF. Office, text, code, OCR, trích văn bản để sau.
- Mỗi trang vẽ thành JPEG (cạnh dài tối đa 1568px, cùng chuẩn với ảnh hiện có). Mỗi batch tối đa 10 trang. PDF dài hơn thì chia nhiều batch, xử lý tuần tự trong cùng hội thoại, **không bỏ trang nào**.
- Mỗi batch gửi kèm câu hỏi của user và ghi chú "trang X–Y trên N". Bot trả ghi chú cho batch (hiện trong chat). Sau batch cuối có một lượt tổng hợp trả lời câu hỏi.
- UI: chip PDF trong ô soạn tin có tiến độ vẽ trang, thẻ PDF trong chat, tiến độ batch, nút Dừng, và viewer xem từng trang (trước/sau, phím mũi tên, số trang, dải thumbnail).
- Reasoning: với LM Studio, stream nội dung reasoning trong khối thu gọn. Đồng hồ giây có sẵn trong `ThoughtDisplay` (đếm từ lúc mount); thiết kế chỉ thêm `key` để nó đếm lại theo từng bước (tool, batch kế).
- Một người dùng, chủ yếu LM Studio; PDF cũng chạy trên Azure. Gateway text-only không đọc được ảnh nên PDF không có tác dụng ở đó.
- Non-goals: Office/text/code, OCR, hộp chọn trang, Responses API cho Azure (issue riêng), reasoning cho Azure và gateway, lưu reasoning vào lịch sử, lưu file PDF gốc.

## 2. Assumptions

1. PDF tối đa **50 MB và 100 trang** (10 batch). Vượt thì từ chối rõ ràng, không cắt lặng lẽ.
2. Vẽ trang ở renderer (canvas có sẵn) bằng pdf.js; main điều phối batch.
3. PDF chỉ xử lý local; chỉ ảnh các trang đi tới LLM đã cấu hình (LM Studio thì không rời máy). pdf.js chạy với script và font ngoài bị tắt (`isEvalSupported: false`); nội dung PDF là dữ liệu, không phải lệnh.
4. Reasoning chỉ hiển thị tạm: không lưu và không gửi lại cho model.
5. Hiệu năng: vẽ 10 trang trong vài giây, không làm đơ UI (vẽ tuần tự, nhả event loop giữa các trang). Bắt đầu vẽ ngay khi đính kèm, nên lúc bấm Gửi thường đã xong.
6. Bảo trì: thêm dependency `pdfjs-dist` (khoảng vài MB trong bản build).
7. pdf.js dùng **bản `legacy`** (`pdfjs-dist/legacy/build/…`): bản thường cần `Uint8Array.prototype.toHex`, Chromium 138 của Electron 37 chưa có (lỗi "a.toHex is not a function", chỉ lộ khi chạy app thật). Nâng Electron thì có thể đổi lại.
8. Giới hạn đã biết: PDF dùng font không nhúng hoặc CJK có thể vẽ kém vì chưa đóng gói `standard_fonts` và `cmaps` của pdf.js. PDF mã hóa bằng mật khẩu bị từ chối.

## 3. Decision log

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| P1 | Chỉ PDF | PDF + text; PDF + Office | Office cần LibreOffice hoặc Quick Look (chỉ Mac). PDF đóng gói sẵn, chạy mọi nền tảng |
| P2 | Batch 10 trang, tuần tự, không bỏ trang | Chỉ lấy 10 trang đầu; hộp chọn trang; nâng giới hạn | User chọn "không bỏ đi". 10 khớp giới hạn 10 ảnh/tin |
| P3 | Tự chạy tuần tự trong cùng hội thoại, ghi chú hiện trong chat, rồi lượt tổng hợp | Gọi ẩn từng batch; chạy thủ công từng batch | Minh bạch, dễ gỡ lỗi, tái dùng agent loop. Ảnh chỉ đi với tin user mới nhất nên ghi chú của bot mang kiến thức giữa các batch |
| P4 | Renderer vẽ trang, main điều phối batch | Renderer điều phối; vẽ ở main bằng canvas native | Stop/Retry đúng với cơ chế có sẵn, đóng cửa sổ không mất trạng thái. Canvas native có rủi ro đóng gói electron-builder |
| P5 | Nhóm PDF nằm trong JSON của tin nhắn, không migration, không bảng mới | Bảng `documents` | `messages.content` đã là JSON, kể cả `attachment_ids` |
| P6 | Tin PDF lưu `document.pages`, không lưu `attachment_ids` | Dùng `attachment_ids` | Tránh 100 nhãn `[ảnh #id]` trong lịch sử. Trang vẫn là attachment `owner_type='message'` nên dọn dẹp như ảnh |
| P7 | Các lượt batch không có tool; chỉ lượt tổng hợp có | Tool đầy đủ ở mọi lượt | Tool ghi tạo thẻ xác nhận và sẽ dừng cả vòng lặp giữa chừng |
| P8 | `nextStep` suy ra từ lịch sử đã lưu, không giữ trạng thái trong bộ nhớ | State machine trong RAM | Thử lại và mở lại app tự tiếp tục đúng chỗ |
| P9 | Lượt tổng hợp kéo cửa sổ lịch sử về tin PDF gốc | Giữ 20 tin | PDF 100 trang tạo hơn 20 tin, mất các ghi chú đầu |
| P10 | PDF và ảnh rời không dùng chung một tin | Cho trộn | Giữ vòng batch đơn giản; thêm sau nếu cần |
| P11 | Provider text-only bỏ vòng batch, chỉ gửi tin PDF kèm cảnh báo | Vẫn chạy batch | Model không thấy ảnh thì batch vô nghĩa |
| P12 | Reasoning cho LM Studio: `delta.reasoning_content` / `delta.reasoning`, và tách thẻ `<think>…</think>` trong nội dung | Chỉ hai trường trên | Tùy model và cấu hình, LM Studio gửi reasoning ở trường riêng hoặc ngay trong `content` |
| P13 | Dùng đồng hồ có sẵn của `ThoughtDisplay`, remount bằng `key` mỗi bước | Tự viết bộ đếm giờ | Brainstorm ban đầu tưởng UI chỉ có dòng tĩnh; chạy thật mới thấy `ThoughtDisplay` đã đếm giây. Tự viết sẽ hiện hai đồng hồ. Azure và gateway không gửi reasoning nhưng vẫn có dấu hiệu "đang chạy" |
| P14 | Viewer tự dựng trên `AionModal` | `Image.PreviewGroup` của Arco | Cần số trang, phím tắt, dải thumbnail, mở đúng trang |
| P15 | Thêm `pdfjs-dist` | Tự viết, native | Chuẩn thực tế, chạy trong renderer |
| P16 | Không lưu file PDF gốc | Lưu bản gốc | Preview chỉ cần ảnh trang; tránh lưu file lớn |
| P17 | Giới hạn 50 MB và 100 trang | Không giới hạn | Chặn chi phí token và bộ nhớ |

## 4. Thiết kế

### Dữ liệu

```ts
// shared/types.ts
export type PdfDoc = { name: string; pages: string[] }; // attachment id theo thứ tự trang
export type BatchInfo = { name: string; part: number; parts: number; from: number; to: number; total: number };
export type UserMessage = {
  role: 'user'; content: string; attachment_ids?: string[]; files?: true;
  document?: PdfDoc;   // tin user gửi kèm PDF
  batch?: BatchInfo;   // nội bộ: một batch trang (ảnh nằm trong attachment_ids)
  final?: true;        // nội bộ: lượt tổng hợp
};
```

`shared/pdf.ts`: `BATCH = 10`, `MAX_PDF_PAGES = 100`, `MAX_PDF_BYTES = 50 MB`, `batchRanges(total)`.

### Luồng

1. Renderer vẽ mọi trang thành JPEG khi bạn đính kèm (chip hiện "Đang đọc trang 7/40"), rồi gửi `chat:send` với `document: { name, pages }`.
2. Main kiểm tra (tối đa 100 trang, mỗi trang qua `toJpeg`), lưu một tin user có `document`, lưu các trang thành attachment của tin đó.
3. `runWithDocuments` gọi `nextStep` trên lịch sử:
   - `batch`: tạo tin nội bộ chứa 10 trang cùng lời dặn ghi chú, chạy một lượt **không tool**.
   - `final`: tạo tin tổng hợp (không ảnh), chạy lượt có đầy đủ tool.
   - `rerun`: tin batch hoặc final cuối chưa có trả lời (lỗi hoặc Stop) thì chạy lại đúng tin đó.
   - `normal`: không thuộc lần xử lý PDF nào, hoặc đã xong, thì chạy `runTurn` như cũ.
4. Các lượt trung gian **chặn sự kiện `done`**; `progress` cho UI biết batch nào.

### Edge case và lỗi

- Lỗi ở batch k: hiện lỗi và nút Thử lại như hiện nay. Ghi chú các batch trước vẫn còn, Thử lại chạy lại từ batch k.
- Stop: hủy lượt hiện tại và dừng vòng lặp.
- Lượt tổng hợp tạo thẻ xác nhận: quy trình kết thúc bình thường; sau khi xác nhận, `nextStep` thấy đã xong và chạy lượt thường.
- Tin mới của user giữa chừng: bỏ lần xử lý PDF đang dở (`normal`).
- Tool call trong lượt batch (model tự gọi dù không được cung cấp) bị bỏ qua, chỉ giữ nội dung.
- PDF hỏng, có mật khẩu, quá lớn, quá nhiều trang: báo lỗi tại chip, không gửi.

### Reasoning

`collect` nhận thêm `onReasoning`. Đọc `delta.reasoning_content ?? delta.reasoning`, và dùng bộ tách `<think>` có trạng thái trong nội dung (giữ lại phần đuôi giống đầu thẻ để thẻ bị cắt giữa hai chunk vẫn tách đúng; bỏ khoảng trắng đầu sau `</think>`). Chỉ bật khi `Llm.reasoning` (hiện chỉ LM Studio). Reasoning không vào `partial.content`, nên không được lưu. Sự kiện mới `{ type: 'reasoning', delta }` tới renderer.

### Giao diện

- SendBox nhận `application/pdf` (chọn, kéo thả, dán); chip PDF có tiến độ vẽ trang; gửi bị khóa tới khi vẽ xong.
- Tin PDF hiện `PdfCard` (tên, "N trang"); tin `batch` và `final` ẩn; câu trả lời liền sau tin batch có nhãn "Ghi chú · trang X–Y/N".
- Dòng trạng thái: "Đang đọc lô 2/4 (trang 11–20)…" và "Đang tổng hợp…" cùng thanh tiến độ mảnh; `ThoughtDisplay` được remount theo `key` mỗi bước để đồng hồ giây đếm lại.
- Khối reasoning thu gọn (`<details>`), mặc định đóng.
- `PdfViewer`: modal xem từng trang, tiêu đề "tên · Trang 3/40", nút Trước/Sau, phím ←, →, Home, End, dải thumbnail tải lười, mở đúng trang được bấm.

## 5. Kiểm thử

- **Unit (main/shared):** `batchRanges`; `nextStep` (mọi nhánh, gồm retry sau lỗi, resume sau thẻ xác nhận, tin mới giữa chừng); bộ tách `<think>` (thẻ bị cắt giữa chunk, không thẻ, thẻ không đóng, khoảng trắng sau thẻ đóng); `collect` với `reasoning_content`, `reasoning` và `<think>`; `buildLlmMessages` (tin PDF không có 100 nhãn, cửa sổ kéo về tin PDF); kiểm tra `document` đầu vào.
- **Vòng lặp với LLM giả:** PDF 25 trang cho 3 batch rồi tổng hợp; batch không có tool, tổng hợp có tool; không có `done` trung gian; Stop giữa chừng; lỗi ở batch 2 rồi Thử lại tiếp tục từ batch 2; provider text-only bỏ vòng batch.
- **Thủ công** (renderer, pdf.js và canvas không chạy được trong vitest): đính kèm PDF thật, xem tiến độ, viewer, Stop, Thử lại, và reasoning với một model LM Studio có thinking.

## 6. Rủi ro đã chấp nhận

- PDF 100 trang tốn nhiều token và thời gian (10 lượt gọi model + 1 tổng hợp). Đo thật với LM Studio và `gemma-4-12b` trên máy dev: lô đầu 10 trang mất khoảng 3,5 phút, lô 2 trang và bước tổng hợp mỗi bước khoảng 20–60 giây; cả PDF 12 trang xong trong khoảng 6 phút. Có thể giảm bằng ảnh nhỏ hơn hoặc lô nhỏ hơn cho model local (chưa làm).
- Model nhỏ ghi chú từng batch kém, và có thể bỏ sót thông tin ở bước tổng hợp.
- `<think>` tách theo văn bản nên một model dùng thẻ khác sẽ không được tách.
- Phần renderer (pdf.js, canvas, viewer) không chạy được trong vitest. Đã kiểm bằng app Electron thật (build `out/`, tải qua `file://` dưới cùng CSP) điều khiển qua Chrome DevTools Protocol với LM Studio thật; chưa chạy trên bản đóng gói `.dmg`.
