import { z } from 'zod/v4';
import { toLocalDate } from '../../shared/dates';
import type { ExpenseRow } from '../../shared/types';
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
  updateRows,
  where,
  writeTool,
} from './common';

const amount = z
  .number()
  .int()
  .positive()
  .max(1e12)
  .describe('Integer in the smallest currency unit. VND has no decimals: 55k → 55000, "1tr2" (Vietnamese shorthand for 1.2 million) → 1200000, "45.000đ" on a receipt → 45000. USD: 12.50 → 1250');
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'errors:currencyFormat')
  .describe('ISO 4217 code, e.g. VND, USD');
const category = z
  .string()
  .trim()
  .min(1)
  .describe('e.g. ăn uống (food), đi lại (transport), nhà cửa (housing), mua sắm (shopping), giải trí (entertainment), sức khỏe (health), khác (other); prefer an existing category');

export const expenseTools = [
  readTool({
    name: 'list_expenses',
    description:
      'List expenses (max 500, newest first) by spent_at date from `from` to `to` (both inclusive), with totals per currency (over all matching expenses, not capped at 500). Amounts are in the smallest currency unit.',
    schema: z.object({
      from: date,
      to: date,
      category: z.string().optional().describe('Exact category match, ignoring case and diacritics'),
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
    description: 'Record an expense (can be read from a receipt photo).',
    schema: z.object({
      amount,
      currency: currency.optional(), // omitted: the user's default currency
      category,
      description: z.string().optional(),
      spent_at: date.optional().describe('Date spent, YYYY-MM-DD (always send it, even for today)'),
      attachment_ids: attachmentIds,
    }),
    apply: (a, { db, now, settings }) => {
      const r = db
        .prepare('INSERT INTO expenses (amount, currency, category, description, spent_at) VALUES (?, ?, ?, ?, ?)')
        .run(a.amount, a.currency ?? settings().defaultCurrency, canonCategory(db, 'expenses', a.category), a.description ?? null, a.spent_at ?? toLocalDate(now()));
      const id = Number(r.lastInsertRowid);
      attachTo(db, 'expense', id, a.attachment_ids);
      return getRows<ExpenseRow>(db, 'expenses', [id])[0];
    },
  }),

  writeTool({
    name: 'update_expenses',
    description: 'Update expenses.',
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
        .refine((p) => Object.keys(p).length > 0, 'errors:emptyPatch'),
    }),
    preview: (a, { db }) => ({ before: requireRows<ExpenseRow>(db, 'expenses', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'expenses', a.ids);
      const patch = a.patch.category ? { ...a.patch, category: canonCategory(db, 'expenses', a.patch.category, a.ids) } : a.patch;
      updateRows(db, 'expenses', a.ids, patch);
      return { updated: getRows<ExpenseRow>(db, 'expenses', a.ids) };
    },
  }),

  writeTool({
    name: 'delete_expenses',
    description: 'Permanently delete expenses (and their images).',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<ExpenseRow>(db, 'expenses', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'expenses', a.ids);
      deleteRows(db, 'expenses', 'expense', a.ids);
      return { deleted: a.ids };
    },
  }),
];
