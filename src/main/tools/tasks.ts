import { z } from 'zod/v4';
import { nextOccurrence, RECURRENCE_RE, toLocalDate } from '../../shared/dates';
import type { TaskRow } from '../../shared/types';
import type { Db } from '../db';
import {
  attachmentIds,
  canonCategory,
  attachmentsCol,
  attachTo,
  date,
  deleteRows,
  getRows,
  ids,
  readTool,
  requireRows,
  time,
  updateRows,
  where,
  writeTool,
} from './common';

const recurrence = z.string().regex(RECURRENCE_RE).describe("'daily' | 'weekly:1,3,5' (1 = T2 … 7 = CN) | 'monthly:15'");
const priority = z.union([z.literal(1), z.literal(2), z.literal(3)]).describe('1 cao, 2 thường, 3 thấp');
const category = z.string().trim().min(1).describe("'work' (công việc) | 'personal' (cá nhân) | category đã có");

const getTask = (db: Db, id: number): TaskRow => getRows<TaskRow>(db, 'tasks', [id])[0];

/** Next occurrence (after the due date or today, whichever is later); the rule moves to the new row so re-completing never spawns twice. */
function spawnNext(db: Db, t: TaskRow, now: Date): TaskRow {
  const today = toLocalDate(now);
  const due = nextOccurrence(t.recurrence!, t.due_date && t.due_date > today ? t.due_date : today);
  const r = db
    .prepare('INSERT INTO tasks (title, notes, category, priority, due_date, due_time, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.title, t.notes, t.category, t.priority, due, t.due_time, t.recurrence);
  db.prepare('UPDATE tasks SET recurrence = NULL WHERE id = ?').run(t.id);
  return getTask(db, Number(r.lastInsertRowid));
}

export const taskTools = [
  readTool({
    name: 'list_tasks',
    description:
      'Liệt kê task (tối đa 200) theo khoảng ngày đến hạn due_date (from/to tính cả hai đầu), trạng thái, phân loại hoặc từ khóa.',
    schema: z.object({
      from: date.optional(),
      to: date.optional(),
      status: z.enum(['todo', 'done', 'cancelled', 'all']).default('todo'),
      category: category.optional(),
      query: z.string().optional().describe('Tìm trong tiêu đề và ghi chú, không phân biệt dấu và hoa thường'),
    }),
    run: (a, { db }) => {
      const w = where([
        ['t.status = :status', 'status', a.status === 'all' ? undefined : a.status],
        ['t.due_date >= :from', 'from', a.from],
        ['t.due_date <= :to', 'to', a.to],
        ['fold(t.category) = fold(:category)', 'category', a.category],
        [
          "(fold(t.title) LIKE fold(:q) ESCAPE '\\' OR fold(t.notes) LIKE fold(:q) ESCAPE '\\')",
          'q',
          a.query ? `%${a.query.replace(/[\\%_]/g, '\\$&')}%` : undefined,
        ],
      ]);
      return db
        .prepare(
          `SELECT t.*, ${attachmentsCol('task', 't.id')} FROM tasks t ${w.sql}
           ORDER BY t.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.priority, t.id LIMIT 200`
        )
        .all(w.params);
    },
  }),

  writeTool({
    name: 'create_task',
    description: 'Tạo một task mới. Người dùng sẽ xác nhận trước khi lưu.',
    schema: z.object({
      title: z.string().min(1),
      notes: z.string().optional(),
      category: category.optional(),
      priority: priority.optional(),
      due_date: date.optional(),
      due_time: time.optional(),
      recurrence: recurrence.optional(),
      attachment_ids: attachmentIds,
    }),
    apply: (a, { db }) => {
      const r = db
        .prepare(
          `INSERT INTO tasks (title, notes, category, priority, due_date, due_time, recurrence)
           VALUES (:title, :notes, :category, :priority, :due_date, :due_time, :recurrence)`
        )
        .run({
          title: a.title,
          notes: a.notes ?? null,
          category: canonCategory(db, 'tasks', a.category ?? 'personal'),
          priority: a.priority ?? 2,
          due_date: a.due_date ?? null,
          due_time: a.due_time ?? null,
          recurrence: a.recurrence ?? null,
        });
      const id = Number(r.lastInsertRowid);
      attachTo(db, 'task', id, a.attachment_ids);
      return getTask(db, id);
    },
  }),

  writeTool({
    name: 'update_tasks',
    description:
      'Sửa một hoặc nhiều task: đánh dấu xong (status=done), dời ngày, đổi phân loại, ưu tiên... ' +
      'Task lặp lại khi xong hoặc hủy (status=cancelled, tức bỏ qua lần này) sẽ tự sinh lần kế tiếp; ' +
      'muốn dừng chuỗi lặp thì đặt recurrence=null. Đặt lại status=todo không xóa lần kế tiếp đã sinh.',
    schema: z.object({
      ids,
      patch: z
        .object({
          title: z.string().min(1).optional(),
          notes: z.string().nullable().optional(),
          category: category.optional(),
          priority: priority.optional(),
          due_date: date.nullable().optional(),
          due_time: time.nullable().optional(),
          status: z.enum(['todo', 'done', 'cancelled']).optional(),
          recurrence: recurrence.nullable().optional(),
        })
        .refine((p) => Object.keys(p).length > 0, 'patch không được rỗng'),
    }),
    preview: (a, { db }) => ({ before: requireRows<TaskRow>(db, 'tasks', a.ids) }),
    apply: (a, { db, now }) => {
      const before = requireRows<TaskRow>(db, 'tasks', a.ids);
      const { status } = a.patch;
      const patch = a.patch.category ? { ...a.patch, category: canonCategory(db, 'tasks', a.patch.category, a.ids) } : a.patch;
      updateRows(db, 'tasks', a.ids, patch, status && status !== 'done' ? { completed_at: null } : {});
      if (status === 'done') {
        const stmt = db.prepare('UPDATE tasks SET completed_at = COALESCE(completed_at, ?) WHERE id = ?');
        for (const id of a.ids) stmt.run(now().toISOString(), id);
      }
      const updated = getRows<TaskRow>(db, 'tasks', a.ids);
      // Closing an open task spawns the next occurrence from the row as updated (new title, rule...).
      const wasOpen = new Set(before.filter((t) => t.status === 'todo').map((t) => t.id));
      const closing = status === 'done' || status === 'cancelled';
      const spawned = closing ? updated.filter((t) => wasOpen.has(t.id) && t.recurrence).map((t) => spawnNext(db, t, now())) : [];
      return { updated: getRows<TaskRow>(db, 'tasks', a.ids), spawned };
    },
  }),

  writeTool({
    name: 'delete_tasks',
    description: 'Xóa hẳn một hoặc nhiều task (kèm ảnh và nhắc nhở của chúng).',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<TaskRow>(db, 'tasks', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'tasks', a.ids);
      deleteRows(db, 'tasks', 'task', a.ids);
      return { deleted: a.ids };
    },
  }),
];
