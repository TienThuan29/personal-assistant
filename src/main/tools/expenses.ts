import { z } from 'zod/v4';
import { toLocalDate } from '../../shared/dates';
import type { ExpenseRow } from '../../shared/types';
import type { Db } from '../db';
import {
  attachmentIds,
  attachmentsCol,
  attachTo,
  date,
  deleteRows,
  getRows,
  ids,
  readTool,
  requireRows,
  updateRows,
  where,
  writeTool,
} from './common';

const amount = z
  .number()
  .int()
  .positive()
  .max(1e12)
  .describe('Số nguyên theo đơn vị nhỏ nhất. VND không có số lẻ: 55k → 55000, 1tr2 → 1200000, "45.000đ" trên hóa đơn → 45000. USD: 12.50 → 1250');
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Mã tiền tệ ISO 4217 gồm 3 chữ cái, vd VND, USD')
  .describe('Mã ISO 4217, vd VND, USD');
const category = z
  .string()
  .trim()
  .min(1)
  .describe('vd: ăn uống, đi lại, nhà cửa, mua sắm, giải trí, sức khỏe, khác (ưu tiên category đã có)');

/**
 * Reuses an existing spelling ('an uong' → 'Ăn uống') so one category never splits by case or accents.
 * `exclude` skips the rows being updated, so renaming all of a category's rows still takes effect.
 */
const canonCategory = (db: Db, c: string, exclude: number[] = []): string =>
  (
    db
      .prepare(`SELECT category FROM expenses WHERE fold(category) = fold(?) AND id NOT IN (${exclude.map(() => '?').join(', ')}) LIMIT 1`)
      .get(c, ...exclude) as { category: string } | undefined
  )?.category ?? c;

export const expenseTools = [
  readTool({
    name: 'list_expenses',
    description:
      'Liệt kê khoản chi (tối đa 500, mới nhất trước) theo ngày chi spent_at từ from đến to (tính cả hai đầu), kèm tổng theo tiền tệ (tính trên mọi khoản khớp, không bị giới hạn 500). Số tiền theo đơn vị nhỏ nhất.',
    schema: z.object({
      from: date,
      to: date,
      category: z.string().optional().describe('Lọc đúng category, không phân biệt hoa thường và dấu'),
    }),
    run: (a, { db }) => {
      const w = where([
        ['e.spent_at >= :from', 'from', a.from],
        ['e.spent_at <= :to', 'to', a.to],
        ['fold(e.category) = fold(:category)', 'category', a.category],
      ]);
      return {
        items: db
          .prepare(`SELECT e.*, ${attachmentsCol('expense', 'e.id')} FROM expenses e ${w.sql} ORDER BY e.spent_at DESC, e.id DESC LIMIT 500`)
          .all(w.params),
        totals: db.prepare(`SELECT e.currency, SUM(e.amount) AS total FROM expenses e ${w.sql} GROUP BY e.currency ORDER BY e.currency`).all(w.params),
      };
    },
  }),

  writeTool({
    name: 'create_expense',
    description: 'Ghi một khoản chi (có thể đọc từ ảnh hóa đơn).',
    schema: z.object({
      amount,
      currency: currency.default('VND'),
      category,
      description: z.string().optional(),
      spent_at: date.optional().describe('Ngày chi YYYY-MM-DD (luôn gửi, kể cả hôm nay)'),
      attachment_ids: attachmentIds,
    }),
    apply: (a, { db, now }) => {
      const r = db
        .prepare('INSERT INTO expenses (amount, currency, category, description, spent_at) VALUES (?, ?, ?, ?, ?)')
        .run(a.amount, a.currency, canonCategory(db, a.category), a.description ?? null, a.spent_at ?? toLocalDate(now()));
      const id = Number(r.lastInsertRowid);
      attachTo(db, 'expense', id, a.attachment_ids);
      return getRows<ExpenseRow>(db, 'expenses', [id])[0];
    },
  }),

  writeTool({
    name: 'update_expenses',
    description: 'Sửa khoản chi.',
    schema: z.object({
      ids,
      patch: z
        .object({
          amount: amount.optional(),
          currency: currency.optional(),
          category: category.optional(),
          description: z.string().nullable().optional(),
          spent_at: date.optional(),
        })
        .refine((p) => Object.keys(p).length > 0, 'patch không được rỗng'),
    }),
    preview: (a, { db }) => ({ before: requireRows<ExpenseRow>(db, 'expenses', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'expenses', a.ids);
      const patch = a.patch.category ? { ...a.patch, category: canonCategory(db, a.patch.category, a.ids) } : a.patch;
      updateRows(db, 'expenses', a.ids, patch);
      return { updated: getRows<ExpenseRow>(db, 'expenses', a.ids) };
    },
  }),

  writeTool({
    name: 'delete_expenses',
    description: 'Xóa hẳn khoản chi (kèm ảnh).',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<ExpenseRow>(db, 'expenses', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'expenses', a.ids);
      deleteRows(db, 'expenses', 'expense', a.ids);
      return { deleted: a.ids };
    },
  }),
];
