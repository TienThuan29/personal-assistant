import { z } from 'zod/v4';
import { readTool } from './common';

const MAX_ROWS = 200;
const SCHEMA = `tasks(id, title, notes, category, priority 1 cao|2 thường|3 thấp, due_date 'YYYY-MM-DD', due_time 'HH:MM', status todo|done|cancelled, recurrence, created_at, completed_at)
reminders(id, task_id, message, remind_at, status pending|fired|dismissed)
notes(id, kind note|journal, title, body, created_at, updated_at)
expenses(id, amount INTEGER minor unit, currency, category, description, spent_at 'YYYY-MM-DD', created_at)
attachments(id, owner_type task|note|expense|message, owner_id, file_name, mime, created_at)`;

export const sqlTools = [
  readTool({
    name: 'query_readonly_sql',
    description:
      'Chạy MỘT câu SELECT/WITH chỉ-đọc trên SQLite cho thống kê mà tool khác không làm được. ' +
      "Cột *_at (trừ spent_at) là ISO UTC: dùng date(x, 'localtime') để lấy ngày địa phương; due_date/spent_at đã là ngày địa phương. " +
      `Tối đa ${MAX_ROWS} dòng. Schema:\n${SCHEMA}`,
    schema: z.object({ sql: z.string().min(1).describe('Một câu SELECT hoặc WITH ... SELECT') }),
    run: (a, { ro }) => {
      const sql = a.sql.trim().replace(/;\s*$/, '');
      if (!/^(select|with)\b/i.test(sql)) throw new Error('Chỉ chấp nhận SELECT hoặc WITH');
      // The connection is opened readOnly; the wrapper also rejects WITH … DELETE and caps the row count.
      // The newline keeps a trailing `-- comment` from swallowing the closing parenthesis.
      const rows = ro.prepare(`SELECT * FROM (${sql}\n) LIMIT ${MAX_ROWS + 1}`).all();
      return rows.length > MAX_ROWS ? { rows: rows.slice(0, MAX_ROWS), truncated: true } : { rows };
    },
  }),
];
