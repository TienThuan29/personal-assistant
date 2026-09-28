import { z } from 'zod/v4';
import type { ReminderRow } from '../../shared/types';
import { deleteRows, getRows, ids, instant, readTool, requireRows, toInstant, updateRows, where, writeTool } from './common';

const remindAt = z.iso
  .datetime({ local: true, offset: true, error: 'Cần thời điểm có giờ, vd 2026-09-29T09:00' })
  .describe('Thời điểm nhắc theo giờ máy, vd 2026-09-29T09:00; phải ở tương lai');

function futureInstant(s: string, now: Date): string {
  const at = toInstant(s);
  if (Date.parse(at) <= now.getTime()) throw new Error('Thời điểm nhắc đã qua');
  return at;
}

export const reminderTools = [
  readTool({
    name: 'list_reminders',
    description: 'Liệt kê nhắc nhở (tối đa 200, theo thời điểm nhắc tăng dần) trong khoảng thời gian, lọc theo trạng thái.',
    schema: z.object({
      from: instant.optional().describe('Từ (bao gồm): ngày YYYY-MM-DD = từ 00:00 ngày đó, hoặc thời điểm ISO 8601'),
      to: instant.optional().describe('Đến: ngày YYYY-MM-DD = tính cả ngày đó; thời điểm ISO 8601 = không bao gồm thời điểm đó'),
      status: z
        .enum(['pending', 'fired', 'dismissed', 'all'])
        .default('pending')
        .describe('pending = chưa nhắc, fired = đã nhắc, dismissed = đã bỏ qua'),
    }),
    run: (a, { db }) => {
      const w = where([
        ['status = :status', 'status', a.status === 'all' ? undefined : a.status],
        ['remind_at >= :from', 'from', a.from ? toInstant(a.from, 'start') : undefined],
        ['remind_at < :to', 'to', a.to ? toInstant(a.to, 'end') : undefined],
      ]);
      return db.prepare(`SELECT * FROM reminders ${w.sql} ORDER BY remind_at LIMIT 200`).all(w.params);
    },
  }),

  writeTool({
    name: 'create_reminder',
    description: 'Tạo nhắc nhở; app sẽ hiện thông báo Windows đúng giờ. Có thể gắn với một task.',
    schema: z.object({
      message: z.string().min(1),
      remind_at: remindAt,
      task_id: z.number().int().positive().optional().describe('ID task liên quan; xóa task thì nhắc nhở bị xóa theo'),
    }),
    apply: (a, { db, now }) => {
      const at = futureInstant(a.remind_at, now());
      if (a.task_id) requireRows(db, 'tasks', [a.task_id]);
      const r = db.prepare('INSERT INTO reminders (task_id, message, remind_at) VALUES (?, ?, ?)').run(a.task_id ?? null, a.message, at);
      return getRows<ReminderRow>(db, 'reminders', [Number(r.lastInsertRowid)])[0];
    },
  }),

  writeTool({
    name: 'update_reminders',
    description:
      'Sửa nhắc nhở: nội dung, thời điểm (dời giờ thì nhắc lại, kể cả nhắc đã hiện hoặc đã bỏ qua), hoặc status=dismissed để bỏ qua.',
    schema: z.object({
      ids,
      patch: z
        .object({ message: z.string().min(1).optional(), remind_at: remindAt.optional(), status: z.literal('dismissed').optional() })
        .refine((p) => Object.keys(p).length > 0, 'patch không được rỗng'),
    }),
    preview: (a, { db }) => ({ before: requireRows<ReminderRow>(db, 'reminders', a.ids) }),
    apply: (a, { db, now }) => {
      requireRows(db, 'reminders', a.ids);
      const patch: Record<string, unknown> = { ...a.patch };
      if (a.patch.remind_at) {
        patch.remind_at = futureInstant(a.patch.remind_at, now());
        patch.status ??= 'pending';
      }
      updateRows(db, 'reminders', a.ids, patch);
      return { updated: getRows<ReminderRow>(db, 'reminders', a.ids) };
    },
  }),

  writeTool({
    name: 'delete_reminders',
    description: 'Xóa hẳn nhắc nhở.',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<ReminderRow>(db, 'reminders', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'reminders', a.ids);
      deleteRows(db, 'reminders', null, a.ids);
      return { deleted: a.ids };
    },
  }),
];
