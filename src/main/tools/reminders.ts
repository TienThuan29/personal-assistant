import { z } from 'zod/v4';
import type { ReminderRow } from '../../shared/types';
import { deleteRows, getRows, ids, instant, readTool, requireRows, toInstant, updateRows, UserError, where, writeTool } from './common';

const remindAt = z.iso
  .datetime({ local: true, offset: true, error: 'errors:remindAtFormat' })
  .describe('Reminder time in the local time zone, e.g. 2026-09-29T09:00; must be in the future');

function futureInstant(s: string, now: Date): string {
  const at = toInstant(s);
  if (Date.parse(at) <= now.getTime()) throw new UserError('reminderPast');
  return at;
}

export const reminderTools = [
  readTool({
    name: 'list_reminders',
    description: 'List reminders (max 200, by reminder time ascending) within a time range, filtered by status.',
    schema: z.object({
      from: instant.optional().describe('From (inclusive): a YYYY-MM-DD date = from 00:00 that day, or an ISO 8601 time'),
      to: instant.optional().describe('Until: a YYYY-MM-DD date = through the end of that day; an ISO 8601 time = exclusive'),
      status: z
        .enum(['pending', 'fired', 'dismissed', 'all'])
        .default('pending')
        .describe('pending = not fired yet, fired = already fired, dismissed = dismissed'),
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
    description: 'Create a reminder; the app shows a Windows notification on time. Can be linked to a task.',
    schema: z.object({
      message: z.string().min(1),
      remind_at: remindAt,
      task_id: z.number().int().positive().optional().describe('ID of the related task; deleting the task deletes its reminders'),
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
      'Update reminders: message, time (moving the time makes it fire again, even if it already fired or was dismissed), or status=dismissed to dismiss.',
    schema: z.object({
      ids,
      patch: z
        .object({ message: z.string().min(1).optional(), remind_at: remindAt.optional(), status: z.literal('dismissed').optional() })
        .refine((p) => Object.keys(p).length > 0, 'errors:emptyPatch'),
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
    description: 'Permanently delete reminders.',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<ReminderRow>(db, 'reminders', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'reminders', a.ids);
      deleteRows(db, 'reminders', null, a.ids);
      return { deleted: a.ids };
    },
  }),
];
