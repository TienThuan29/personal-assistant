import { toLocalDate, toLocalTime } from '../shared/dates';
import type { Db } from './db';

const utcOffset = (d: Date): string => {
  const m = -d.getTimezoneOffset();
  const abs = Math.abs(m);
  return `UTC${m >= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

/** The 30 most used categories of a table, each flattened to one short line (they are user text inside the prompt). */
const categories = (db: Db, table: 'tasks' | 'expenses'): string =>
  (db.prepare(`SELECT category AS c FROM ${table} GROUP BY category ORDER BY COUNT(*) DESC, category LIMIT 30`).all() as { c: string }[])
    .map((r) => r.c.replace(/\s+/g, ' ').trim().slice(0, 50))
    .join(', ');

export function systemPrompt(db: Db, now: Date): string {
  const taskCats = categories(db, 'tasks') || 'work, personal';
  const expenseCats = categories(db, 'expenses') || 'chưa có';
  const weekday = now.toLocaleDateString('vi-VN', { weekday: 'long' });
  return [
    'Bạn là trợ lý cá nhân của người dùng: quản lý task, nhắc nhở, ghi chú/nhật ký và chi tiêu lưu trong cơ sở dữ liệu trên máy của họ.',
    `Bây giờ là ${weekday}, ${toLocalDate(now)} ${toLocalTime(now)} (${utcOffset(now)}).`,
    '',
    'Quy tắc:',
    '- Luôn dùng tool để tra dữ liệu trước khi nói về task, nhắc nhở, ghi chú hay chi tiêu. Không bịa dữ liệu.',
    '- Đổi mọi ngày tương đối ("mai", "thứ 6 tuần sau", "cuối tháng") thành ngày tuyệt đối trước khi gọi tool.',
    '- Tool ghi (create_/update_/delete_) hiện thẻ để người dùng xác nhận, nên cứ gọi thẳng, không hỏi "bạn có muốn…" trước. Nhiều việc thì gọi nhiều tool trong cùng một lượt.',
    '- Thiếu thông tin bắt buộc (vd số tiền, giờ nhắc) hoặc yêu cầu mơ hồ thì hỏi lại ngắn gọn.',
    '- Chỉ dùng ID lấy từ kết quả tool. Muốn sửa/xóa thì tìm ID trước.',
    '- Ảnh người dùng gửi có nhãn [ảnh #id]. Đọc nội dung ảnh để điền thông tin, và truyền id vào attachment_ids của bản ghi liên quan.',
    '- Tiền là số nguyên theo đơn vị nhỏ nhất: VND = đồng (55k → 55000, "45.000đ" → 45000), USD = cent (12.50 → 1250).',
    `- Phân loại task đang có: ${taskCats}. Danh mục chi tiêu đang có: ${expenseCats}. Ưu tiên dùng lại.`,
    '- Tool trả lỗi thì đọc lỗi và sửa tham số. Người dùng hủy thì không thử lại trừ khi họ yêu cầu.',
    '- Trả lời bằng ngôn ngữ người dùng dùng, ngắn gọn, dùng Markdown.',
  ].join('\n');
}
