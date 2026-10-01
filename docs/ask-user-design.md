# Thẻ câu hỏi của AI (human in the loop) — thiết kế

Ngày: 2026-10-01. Liên quan: `src/main/agent.ts`, `src/main/tools/`, `src/renderer/chat/ConfirmCard.tsx`, `docs/design.md`.

## Tóm tắt

- Khi AI cần hỏi người dùng, nó gọi tool mới `ask_user` thay cho câu hỏi dạng văn bản. Chat hiện một **thẻ tương tác**; AI dừng lại chờ, câu trả lời quay về AI dưới dạng kết quả tool rồi lượt chat tiếp tục.
- Thẻ hiện **một câu hỏi mỗi lần**; có nhiều câu (tối đa 4) thì có nút Prev/Next, bước cuối là Submit. Mỗi câu có 0–4 lựa chọn do AI viết, cộng một dòng **Other** (nhập tự do) luôn do ứng dụng thêm, không phải AI.
- AI chọn từng câu là chọn một (radio) hay chọn nhiều (checkbox). Ở chọn nhiều, văn bản Other kết hợp được với các ô đã tích.
- Dùng cho mọi câu hỏi làm rõ: thiếu thông tin bắt buộc, đích mơ hồ (nhiều bản ghi khớp), chọn giữa các cách hiểu, và câu hỏi mở (thẻ chỉ có ô nhập tự do, 0 lựa chọn).
- Đang có thẻ hỏi mở mà người dùng gõ tin nhắn bình thường ở ô gửi thì tin đó chính là câu trả lời: thẻ đóng lại là "trả lời trong chat" và tin nhắn gửi đi như thường.
- Hiện tại: AI hỏi bằng văn bản Markdown và người dùng gõ trả lời; thẻ xác nhận ghi (`ConfirmCard`) đã có cơ chế dừng/tiếp tục qua `pending_actions`, tính năng này dùng lại cơ chế đó.
- Ngoài phạm vi: ô nhập khác ngoài văn bản (ngày, số, thanh trượt), trình dựng form, câu hỏi ngoài chat, đổi thẻ xác nhận ghi, nút Skip riêng (gõ tin nhắn đã là cách bỏ qua).

## Giả định

1. Thẻ hỏi chưa trả lời nằm trong cơ sở dữ liệu như thẻ xác nhận đang chờ; mở lại ứng dụng thì vẫn còn (bước đang xem và lựa chọn chưa gửi thì mất).
2. Trả lời xong, thẻ chỉ đọc và hiện các lựa chọn đã chọn.
3. AI viết câu hỏi và lựa chọn theo ngôn ngữ người dùng; ứng dụng chỉ dịch phần cố định (Other, Prev, Next, Submit, trạng thái).
4. Kết quả tool là JSON gọn `{ answers: [{ question, picked[], other? }] }`, cùng thứ tự với câu hỏi.
5. Giới hạn: ≤ 4 câu, ≤ 4 lựa chọn mỗi câu, câu hỏi ≤ 200 ký tự, lựa chọn ≤ 80, văn bản Other ≤ 500. Model sai giới hạn thì nhận lỗi tool như các tool khác.
6. Hiệu năng, quy mô, bảo mật không đổi: chạy cục bộ, một người dùng, không thêm gọi mạng hay phụ thuộc. Văn bản Other đi tới LLM như mọi tin nhắn chat.
7. Một câu hỏi không bao giờ được lưu dở: lưu cùng tin nhắn của assistant trong một transaction, như tool ghi.
8. Giữ mã nhỏ, theo mẫu tool/thẻ sẵn có.

## Nhật ký quyết định

| # | Quyết định | Phương án khác | Lý do |
|---|---|---|---|
| Q1 | Một thẻ, một câu hỏi hiện mỗi lần, Prev/Next khi có nhiều câu; 0–4 lựa chọn + Other | Mọi câu trên một thẻ với một nút Submit; mỗi câu một thẻ | Người dùng chọn (sửa đề xuất ban đầu của tôi) |
| Q2 | Gõ ở ô gửi khi thẻ đang mở = câu trả lời (thẻ đóng kiểu `inChat`) | Hủy thẻ rồi gửi tin; khóa ô gửi tới khi trả lời | Cùng hiệu quả với Other mà không tốn thao tác; không khóa người dùng |
| Q3 | Dùng thẻ cho cả bốn loại câu hỏi (thiếu thông tin, đích mơ hồ, cách hiểu, câu hỏi mở) | Chỉ một số loại | Người dùng chọn cả bốn; câu hỏi mở là thẻ chỉ có ô nhập |
| Q4 | Cách A: loại tool `ask` đỗ trong `pending_actions` | B: bảng `asks` riêng; C: khối JSON trong văn bản | Dùng lại cơ chế dừng/tiếp tục/khởi động lại, không cần migration; C không có lược đồ kiểm tra và AI không thật sự dừng |
| Q5 | Lựa chọn là chuỗi thuần (id/gợi ý nằm trong nhãn) | Đối tượng `{label, description}` | YAGNI; nhãn như "#12 Họp team 9h" đã đủ |
| Q6 | Không có nút Skip | Nút Skip riêng | Gõ tin nhắn (Q2) đã là cách bỏ qua; có dòng gợi ý trên thẻ |
| Q7 | Gõ thay trả lời: `cancelled` + `result: { inChat: true }`, kết quả tool `{ skipped: true, note }` | Dùng `confirmed` | AI đọc tin kế tiếp như câu trả lời; thẻ hiện "Đã trả lời trong chat", không giả làm có đáp án |

## Thiết kế

### 1. Tool và luồng phía main

- `src/main/tools/ask.ts`: tool `ask_user`, loại mới `ask` bên cạnh `read`/`write` trong `common.ts`. Tham số `{ questions: 1–4 × { question, options: string[0–4], multiple (mặc định false) } }`, zod ép các giới hạn. Nằm trong `TOOLS` nên Azure lẫn adapter gateway nhận được tool mà không cần mã thêm.
- `handleCall` (agent.ts): tool `ask` được kiểm tra rồi `createAction` (`preview: null`), trả `'parked'`, lượt dừng và phát `pending` như tool ghi.
- `answerAction(deps, actionId, answers)`: kiểm tra số câu trả lời bằng số câu hỏi, mỗi `picked` phải thuộc lựa chọn của câu đó, chọn một thì tối đa một mục, mỗi câu có ít nhất một lựa chọn hoặc văn bản Other không rỗng, độ dài Other. Hợp lệ thì `finishAction(…, 'confirmed', args, { answers })` và trả lời tool call bằng JSON đó; trả `true` khi không còn action chờ để nơi gọi tiếp tục lượt. Sai thì ném `invalidAnswer` và action vẫn chờ.
- IPC `chat:answer(actionId, answers)` giống `chat:resolve` (dừng lượt cũ, tiếp tục lượt) nhưng không gọi `onDataChanged` vì dữ liệu không đổi.
- `cancelOpenActions`: action `ask` đang chờ được đóng là `cancelled` với `{ inChat: true }` và tool trả `{ skipped: true, note }`, trong transaction gửi tin sẵn có.
- Prompt: quy tắc "hỏi lại ngắn gọn" đổi thành "mọi câu hỏi làm rõ dùng `ask_user`, đưa 2–4 lựa chọn khả dĩ khi có thể, không tự thêm lựa chọn Other, gom mọi câu hỏi vào một lần gọi, chỉ hỏi khi thật cần".

### 2. Thẻ trong chat

- `MessageRow` vẫn chọn thẻ theo `message_id`, nhưng với action `ask_user` thì render `AskCard`. "Xác nhận tất cả (n)" chỉ đếm thẻ ghi.
- `AskCard` dùng khung `.confirm-card`, tiêu đề "Câu hỏi từ trợ lý", thẻ trạng thái "Chờ trả lời". Hiện một câu mỗi bước, có chỉ báo "2/3" khi nhiều câu. Chọn một = danh sách radio, chọn nhiều = checkbox; dòng Other luôn ở cuối, mở ô nhập khi chọn. Chọn một: chọn Other thì bỏ radio đã chọn; chọn nhiều: kết hợp được. Câu 0 lựa chọn chỉ có ô nhập tự do, không có dòng Other.
- Prev tắt ở bước 1; Next tắt tới khi câu hiện tại có lựa chọn hoặc văn bản Other; bước cuối Next thành Submit, bật khi mọi câu đã có đáp án. Thẻ một câu chỉ có Submit. Một dòng mờ: "Hoặc gõ trả lời ở ô bên dưới". Bước và lựa chọn là state cục bộ của thẻ, chưa gửi gì tới khi Submit.
- Đã trả lời: chỉ đọc, thẻ xanh "Đã trả lời", liệt kê câu hỏi → đáp án (Other hiện đúng chữ đã gõ). Gõ thay: thẻ xám "Đã trả lời trong chat", chỉ hiện câu hỏi.
- `useChat.answer(actionId, answers)` dùng chung phần "gọi, tải lại, đánh dấu đang chạy nếu không còn thẻ" với `resolve`; `api.chat.answer` thêm vào kiểu `Api`, preload và IPC.
- Chuỗi mới trong `chat` của `vi.ts` và `en.ts`; kiểu dáng dùng lại token màu nhấn nên sáng/tối và màu tuỳ chỉnh hoạt động sẵn.

### 3. Lỗi, trường hợp biên, kiểm thử

- Model sai tham số (5 lựa chọn, câu hỏi rỗng…): lỗi tool qua `parseArgs`, model thử lại. Trả lời sai từ UI: `invalidAnswer` (vi, en), action vẫn chờ, thẻ hiện lỗi.
- Một lượt có cả thẻ hỏi lẫn thẻ ghi, hoặc hai thẻ hỏi: đều được đỗ, lượt tiếp tục sau thẻ cuối. Khởi động lại: thẻ chờ trở lại. Stop/Retry: lượt đã dừng ở `pending`, Retry chỉ phát lại `pending`.
- Gateway: model phải phát `ask_user` trong khối tool văn bản; sai tham số thì đi đường lỗi rồi thử lại. Kiểm tra adapter lúc lập kế hoạch.
- Hỏi quá nhiều: nhắc trong prompt và thêm 2 ca vào bộ eval LLM tuỳ chọn (thiếu số tiền thì phải hỏi; đủ thông tin thì không hỏi).
- Kiểm thử (vitest): lược đồ `ask_user` (0 lựa chọn được, 5 lựa chọn và 5 câu bị từ chối); `handleCall` đỗ tool; `answerAction` ghi đáp án hợp lệ và trả `true` khi là thẻ cuối, từ chối lựa chọn lạ / hai lựa chọn ở câu chọn một / câu trống và để action chờ; `cancelOpenActions` đóng thẻ `inChat`; prompt chứa quy tắc mới.
- Kiểm tra hình ảnh: profile nháp có seed (`PA_SEED_DB`) thêm một ask, chụp sáng/tối cả thẻ mở lẫn đã trả lời (renderer chưa có test component). Thêm một bước vào `docs/smoke-test.md`, cập nhật memory dự án.

## As built

- Loại tool mới `ask` nằm trong `common.ts` (`askTool`); `ask_user` ở `src/main/tools/ask.ts`, giới hạn trong `ASK_LIMITS` (dùng chung cho zod và `answerAction`). Tên tool và các kiểu `AskQuestion`/`AskReply`/`AskAnswer` ở `src/shared/types.ts`.
- `answerAction` kiểm tra bằng `checkReplies`: lấy chữ câu hỏi từ dữ liệu đã lưu (không tin chữ do renderer gửi), cắt khoảng trắng của Other, từ chối lựa chọn lạ/lặp, chọn một mà có hơn một đáp án (kể cả pick + Other), câu trống, Other quá 500 ký tự, số câu trả lời sai. Gọi trên thẻ ghi cũng bị từ chối (`invalidAnswer`).
- Gõ thay trả lời đi qua nhánh `cancel` của `resolveAction` (nên `cancelOpenActions` không phải sửa); nhánh này nhận ra `ask_user` và ghi `{ inChat: true }` + tool trả `{ skipped: true, note }`.
- `useChat`: phần "gọi, tải lại, đánh dấu đang chạy" tách thành `settle`, `resolve` và `answer` cùng dùng.
- `AskCard.tsx`: nháp từng câu giữ trong state của thẻ nên Prev/Next không mất lựa chọn; Next tắt tới khi câu hiện tại có đáp án, Gửi tắt tới khi mọi câu có đáp án. Câu không có lựa chọn chỉ có ô nhập (tự mở, không có dòng Khác).
- Prompt: quy tắc hỏi lại đổi như thiết kế, thêm một dòng giải thích `skipped: true`. Bộ eval LLM tuỳ chọn: hai ca thiếu thông tin ("Tôi vừa chi tiền", "Thêm task") nay mong đợi `ask_user`; ca đủ thông tin ("Vừa ăn phở hết 55k") vẫn mong đợi `create_expense`, tức là không hỏi.
- `tests/seed-demo.test.ts` thêm một chat có đủ ba trạng thái thẻ để chụp màn hình.
- Đã kiểm: 18 test mới (tổng 245 pass / 21 skip), typecheck, ảnh chụp sáng/tối ba trạng thái, và chạy thật qua CDP trên profile nháp (chọn, Tiếp/Trước giữ lựa chọn, Khác + gõ chữ, Gửi qua IPC → thẻ thành "Đã trả lời", lượt tiếp tục tới lỗi "Chưa cấu hình LLM" như mong đợi).
- Chưa kiểm: hành vi của LLM thật (có dùng `ask_user` đúng lúc, không hỏi thừa) và đường gateway (khối ```tool_calls); đó là bước trong `docs/smoke-test.md` và bộ eval tuỳ chọn.

### Chỉnh cho gateway (sau lần chạy thật đầu tiên)

- Trên LLM gateway thật (`gpt-5.1-02`) bản đầu gần như không bao giờ gọi `ask_user`: mô hình vẫn hỏi bằng chữ và hỏi cả những thứ tự suy ra được (đo được 2/8 câu thử đúng hành vi). Nguyên nhân: gateway bỏ qua `tools`, mô hình phải tự viết khối ```tool_calls và quy tắc "dùng ask_user" quá nhẹ.
- Đã sửa: quy tắc hỏi lên đầu danh sách quy tắc, viết cứng ("NEVER ask in plain text"), thêm quy tắc không hỏi điều có thể mặc định hoặc đã nói rõ, quy tắc "chi tiền là khoản chi dù nói 'note lại'", và vài ví dụ (kể cả câu hỏi mở với `options: []`); phần hướng dẫn gọi tool của gateway có thêm một ví dụ khối `ask_user` hoàn chỉnh và nhắc đóng khối bằng ``` ở dòng riêng.
- Bộ phân tích khối `tool_calls` nay chấp nhận dấu ``` đóng ngay sau JSON trên cùng dòng (mô hình hay làm vậy), trước đây bị coi là khối hỏng.
- Kết quả đo lại (3 lần mỗi câu, vòng lặp agent thật, tool đọc chạy trên DB rỗng): 24/24 trên bộ 8 câu dùng để chỉnh và 30/30 trên 10 câu mới chưa xuất hiện trong prompt. Mô hình vẫn có thể hỏi thừa hoặc quên dùng thẻ ở câu lạ; chạy lại `tests/eval.llm.test.ts` sau mỗi lần đổi prompt.
