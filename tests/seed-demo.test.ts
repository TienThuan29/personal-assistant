import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/main/db';
import { addMessage, createAction, createConversation, finishAction } from '../src/main/store';
import type { ToolCtx } from '../src/main/tools';
import { addDays, parseLocalDate, toLocalDate, toLocalMinute } from '../src/shared/dates';
import { DEFAULT_UI } from '../src/shared/types';
import { callTool } from './helpers';

/**
 * Opt-in: fills a DB with demo data relative to today, for screenshots.
 *   mkdir -p $P && PA_SEED_DB=$P/assistant.db bun run test tests/seed-demo.test.ts
 * then launch the app with --user-data-dir=$P (it opens <userData>/assistant.db).
 */
const path = process.env.PA_SEED_DB;

describe.skipIf(!path)('seed demo data', () => {
  it('seeds tasks, notes, expenses and reminders', () => {
    const db = openDb(path!);
    const ro = new DatabaseSync(path!, { readOnly: true });
    const ctx: ToolCtx = { db, ro, now: () => new Date(), settings: () => DEFAULT_UI };
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('tasks'), 'already seeded; use a fresh profile').toBe(0);

    const today = toLocalDate();
    const weekday = parseLocalDate(today).getDay() || 7; // 1 = Monday … 7 = Sunday
    const tasks = [
      { title: 'Gửi báo cáo tiến độ quý 3', category: 'work', priority: 1, due_date: addDays(today, -2) },
      { title: 'Gia hạn bảo hiểm xe máy', category: 'personal', due_date: addDays(today, -1) },
      { title: 'Họp team dự án Alpha', category: 'work', priority: 1, due_date: today, due_time: '09:30', notes: 'Chuẩn bị slide demo tính năng mới' },
      { title: 'Tập gym', category: 'personal', due_date: today, due_time: '18:00', recurrence: `weekly:${weekday}` },
      { title: 'Review pull request của Minh', category: 'work', priority: 3, due_date: today },
      { title: 'Đặt vé xe về quê', category: 'personal', due_date: addDays(today, 2) },
      { title: 'Chuẩn bị tài liệu onboarding', category: 'work', due_date: addDays(today, 5) },
      { title: 'Đọc xong cuốn "Nhà giả kim"', category: 'personal', priority: 3 },
    ];
    for (const t of tasks) callTool(ctx, 'create_task', t);

    const notes = [
      { title: 'Ý tưởng app học tiếng Nhật', body: 'Flashcard theo chủ đề, nhắc ôn tập theo lặp lại ngắt quãng, có chế độ nghe.' },
      { title: 'Công thức phở bò', body: 'Xương ống 2kg, quế, hồi, thảo quả, gừng nướng, hành nướng. Hầm ít nhất 6 tiếng.' },
      { title: 'Wifi nhà bác Hai', body: 'Tên mạng: NhaBacHai_5G. Hỏi lại mật khẩu khi tới.' },
      { title: 'Sách muốn đọc', body: 'Đắc nhân tâm; Sapiens; Người giàu có nhất thành Babylon; Muôn kiếp nhân sinh.' },
      {
        title: 'Kế hoạch du lịch Đà Lạt',
        body:
          'Đi 3 ngày 2 đêm vào cuối tháng sau, cả nhà bốn người. Ngày đầu đi xe giường nằm đêm từ Sài Gòn, sáng tới nơi ăn bánh căn và uống sữa đậu nành nóng ở chợ. ' +
          'Buổi chiều ghé đồi chè Cầu Đất, tối dạo hồ Xuân Hương và chợ đêm. Ngày thứ hai thuê xe máy đi thác Datanla, làng Cù Lần, trưa ăn lẩu gà lá é. ' +
          'Ngày cuối mua dâu tây, mứt và atisô làm quà, chiều bắt xe về. Ngân sách dự kiến khoảng 8 triệu, chưa tính quà. Nhớ mang áo khoác dày vì buổi tối trời lạnh.',
      },
      { kind: 'journal', body: 'Hôm nay chạy bộ 5km quanh công viên, thấy khỏe hẳn. Buổi chiều họp khá căng nhưng chốt được kế hoạch.' },
    ];
    for (const n of notes) callTool(ctx, 'create_note', n);

    // Days this month, never in the future; early in the month they collapse onto the 1st.
    const dayOfMonth = parseLocalDate(today).getDate();
    const day = (back: number) => addDays(today, -Math.min(back, dayOfMonth - 1));
    const expenses = [
      [55000, 'ăn uống', 'Phở bò', 0],
      [35000, 'ăn uống', 'Cà phê sữa đá', 0],
      [120000, 'đi lại', 'Grab đi làm', 0],
      [45000, 'ăn uống', 'Cơm tấm', 1],
      [350000, 'mua sắm', 'Áo thun', 1],
      [180000, 'giải trí', 'Vé xem phim', 2],
      [1200000, 'nhà cửa', 'Tiền điện tháng này', 2],
      [65000, 'ăn uống', 'Bún chả', 2],
      [250000, 'sức khỏe', 'Thuốc và vitamin', 4],
      [40000, 'đi lại', 'Gửi xe tháng', 4],
      [89000, 'ăn uống', 'Trà sữa với đồng nghiệp', 4],
      [420000, 'mua sắm', 'Nồi chiên không dầu (trả góp)', 6],
      [300000, 'nhà cửa', 'Internet', 6],
    ] as const;
    for (const [amount, category, description, back] of expenses) callTool(ctx, 'create_expense', { amount, category, description, spent_at: day(back) });
    callTool(ctx, 'create_expense', { amount: 1299, currency: 'USD', category: 'giải trí', description: 'Spotify + iCloud', spent_at: day(1) });

    // Two later today: in 1h and 3h, or in 5 and 15 min when that would pass 23:40 (after ~23:45 these spill past midnight rather than fail as past).
    const now = Date.now();
    const lastSlot = parseLocalDate(addDays(today, 1)).getTime() - 20 * 60_000;
    const laterToday = (ms: number) => toLocalMinute(new Date(now + ms < lastSlot ? now + ms : now + ms / 12));
    const reminders = [
      { message: 'Uống thuốc', remind_at: laterToday(60 * 60_000) },
      { message: 'Gọi điện cho mẹ', remind_at: laterToday(3 * 60 * 60_000) },
      { message: 'Nộp tiền điện', remind_at: `${addDays(today, 1)}T08:00` },
      { message: 'Sinh nhật Lan, mua quà', remind_at: `${addDays(today, 3)}T19:00` },
      { message: 'Lấy đồ giặt ủi', remind_at: `${addDays(today, 6)}T17:30` },
    ];
    for (const r of reminders) callTool(ctx, 'create_reminder', r);

    // One chat holding every ask_user state: answered, closed by typing, and open (two questions: single, then multiple).
    const conv = createConversation(db);
    const ask = (userText: string, questions: object[], close?: { status: 'confirmed' | 'cancelled'; result: unknown }) => {
      const id = `ask${conv}${count('pending_actions')}`;
      addMessage(db, conv, { role: 'user', content: userText });
      const messageId = addMessage(db, conv, {
        role: 'assistant',
        content: 'Mình cần hỏi thêm một chút.',
        tool_calls: [{ id, type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions }) } }],
      });
      const actionId = createAction(db, { conversation_id: conv, message_id: messageId, tool_call_id: id, tool_name: 'ask_user', args: { questions }, preview: null });
      if (!close) return;
      finishAction(db, actionId, close.status, { questions }, close.result);
      addMessage(db, conv, { role: 'tool', tool_call_id: id, content: JSON.stringify(close.result) });
    };
    const q = (question: string, options: string[], multiple = false) => ({ question, options, multiple });
    const answers = [{ question: 'Khoản chi này thuộc danh mục nào?', picked: ['ăn uống'] }];
    ask('Ghi 45k', [q('Khoản chi này thuộc danh mục nào?', ['ăn uống', 'đi lại', 'mua sắm'])], { status: 'confirmed', result: { answers } });
    ask('Xóa task họp', [q('Bạn muốn xóa task nào?', ['#3 Họp team dự án Alpha', '#9 Họp phụ huynh'])], { status: 'cancelled', result: { inChat: true } });
    ask('Nhắc mình đi khám', [
      q('Nhắc vào ngày nào?', ['Ngày mai', 'Thứ 6 tuần này', 'Thứ 2 tuần sau']),
      q('Nhắc lúc mấy giờ? (chọn được nhiều)', ['8:00', '12:00', '18:00'], true),
    ]);

    expect([count('tasks'), count('notes'), count('expenses'), count('reminders')]).toEqual([8, 6, 14, 5]);
    ro.close();
    db.close();
  });
});
