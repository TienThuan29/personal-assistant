import { z } from 'zod/v4';
import { readTool, UserError } from './common';

const MAX_ROWS = 200;
const MAX_CELL = 500;
const SCHEMA = `tasks(id, title, notes, category, priority 1 cao|2 thường|3 thấp, due_date 'YYYY-MM-DD', due_time 'HH:MM', status todo|done|cancelled, recurrence, created_at, completed_at)
reminders(id, task_id, message, remind_at, status pending|fired|dismissed)
notes(id, kind note|journal, title, body, created_at, updated_at)
expenses(id, amount INTEGER minor unit, currency, category, description, spent_at 'YYYY-MM-DD', created_at)
attachments(id, owner_type task|note|expense|message, owner_id, file_name, mime, created_at)`;

const cell = (v: unknown): unknown =>
  v instanceof Uint8Array ? `[blob ${v.byteLength} bytes]` : typeof v === 'string' && v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}…` : v;

export const sqlTools = [
  readTool({
    name: 'query_readonly_sql',
    description:
      'Chạy MỘT câu SELECT/WITH chỉ-đọc trên SQLite cho thống kê mà tool khác không làm được. ' +
      "Cột *_at (trừ spent_at) là ISO UTC: dùng date(x, 'localtime') để lấy ngày địa phương; due_date/spent_at đã là ngày địa phương. " +
      `Tối đa ${MAX_ROWS} dòng; chuỗi dài bị cắt còn ${MAX_CELL} ký tự (đọc toàn văn ghi chú bằng get_notes). Schema:\n${SCHEMA}`,
    schema: z.object({ sql: z.string().min(1).describe('Một câu SELECT hoặc WITH ... SELECT') }),
    run: (a, { ro }) => {
      const sql = a.sql.trim().replace(/;\s*$/, '');
      if (!/^(select|with)\b/i.test(sql)) throw new UserError('sqlSelectOnly');
      // The connection is opened readOnly; the wrapper also rejects WITH … DELETE and caps the row count.
      // The newline keeps a trailing `-- comment` from swallowing the closing parenthesis.
      // prepare() ignores everything after the first ';', so `...); SELECT (1` drops the LIMIT: iterate() still stops at the cap.
      // ponytail: no query timeout (sync main thread); move to a worker + terminate if hangs are seen
      const rows: Record<string, unknown>[] = [];
      for (const row of ro.prepare(`SELECT * FROM (${sql}\n) LIMIT ${MAX_ROWS + 1}`).iterate()) {
        if (rows.length === MAX_ROWS) return { rows, truncated: true };
        rows.push(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)])));
      }
      return { rows };
    },
  }),
];
