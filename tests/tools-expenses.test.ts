import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import { findTool, parseArgs } from '../src/main/tools';
import type { ExpenseList, ExpenseRow } from '../src/shared/types';
import { callTool, testCtx } from './helpers';

describe('expense tools', () => {
  it('defaults to today and VND', () => {
    const ctx = testCtx();
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 45_000, category: 'ăn uống' });
    expect(e).toMatchObject({ amount: 45_000, currency: 'VND', spent_at: '2026-09-28' });
  });

  it("defaults to the user's currency, but keeps an explicit one", () => {
    const ctx = testCtx(undefined, { defaultCurrency: 'USD' });
    expect(callTool<ExpenseRow>(ctx, 'create_expense', { amount: 1250, category: 'food' }).currency).toBe('USD');
    expect(callTool<ExpenseRow>(ctx, 'create_expense', { amount: 5, category: 'food', currency: 'eur' }).currency).toBe('EUR');
  });

  it('lists a range with totals per currency', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_expense', { amount: 45_000, category: 'ăn uống', spent_at: '2026-09-01' });
    callTool(ctx, 'create_expense', { amount: 30_000, category: 'đi lại', spent_at: '2026-09-15' });
    callTool(ctx, 'create_expense', { amount: 999, category: 'khác', spent_at: '2026-10-01' });
    const r = callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-01', to: '2026-09-30' });
    expect(r.items).toHaveLength(2);
    expect(r.totals).toEqual([{ currency: 'VND', total: 75_000 }]);
  });

  it('requires a positive integer amount', () => {
    const tool = findTool('create_expense')!;
    expect(() => parseArgs(tool, { amount: 12.5, category: 'x' })).toThrow();
    expect(() => parseArgs(tool, { amount: 0, category: 'x' })).toThrow();
    expect(() => parseArgs(tool, { amount: 1e12 + 1, category: 'x' })).toThrow();
  });

  it('normalizes currency to uppercase ISO 4217 and totals each currency', () => {
    const ctx = testCtx();
    const tool = findTool('create_expense')!;
    expect(() => parseArgs(tool, { amount: 1, category: 'x', currency: 'đồng' })).toThrow();
    expect(() => parseArgs(tool, { amount: 1, category: 'x', currency: 'US1' })).toThrow();
    callTool(ctx, 'create_expense', { amount: 1250, category: 'x', currency: 'usd' });
    callTool(ctx, 'create_expense', { amount: 50, category: 'x', currency: ' USD ' });
    callTool(ctx, 'create_expense', { amount: 10_000, category: 'x' });
    const r = callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28' });
    expect(r.totals).toEqual([
      { currency: 'USD', total: 1300 },
      { currency: 'VND', total: 10_000 },
    ]);
  });

  it('filters by category ignoring case and accents', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_expense', { amount: 45_000, category: 'Ăn uống' });
    callTool(ctx, 'create_expense', { amount: 30_000, category: 'đi lại' });
    const r = callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28', category: 'ăn uống' });
    expect(r.items.map((e) => e.amount)).toEqual([45_000]);
    expect(r.totals).toEqual([{ currency: 'VND', total: 45_000 }]);
    const plain = callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28', category: 'an uong' });
    expect(plain.items.map((e) => e.amount)).toEqual([45_000]);
  });

  it('reuses the existing spelling of a category and rejects a blank one', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_expense', { amount: 1, category: 'Ăn uống' });
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 2, category: ' an uong ' });
    expect(e.category).toBe('Ăn uống');
    const other = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 3, category: 'khác' });
    callTool(ctx, 'update_expenses', { ids: [other.id], patch: { category: 'AN UONG' } });
    expect(ctx.db.prepare('SELECT DISTINCT category FROM expenses').all()).toEqual([{ category: 'Ăn uống' }]);
    expect(() => parseArgs(findTool('create_expense')!, { amount: 1, category: '   ' })).toThrow();
  });

  it('renames a category when every row with it is updated', () => {
    const ctx = testCtx();
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 1, category: 'an uong' });
    const r = callTool<{ updated: ExpenseRow[] }>(ctx, 'update_expenses', { ids: [e.id], patch: { category: 'Ăn uống' } });
    expect(r.updated[0].category).toBe('Ăn uống');
  });

  it('snaps a partial rename to the spelling of the other rows', () => {
    const ctx = testCtx();
    const a = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 1, category: 'an uong' });
    callTool(ctx, 'create_expense', { amount: 2, category: 'an uong' });
    const r = callTool<{ updated: ExpenseRow[] }>(ctx, 'update_expenses', { ids: [a.id], patch: { category: 'AN UONG' } });
    expect(r.updated[0].category).toBe('an uong');
  });

  it('previews an update with the current row', () => {
    const ctx = testCtx();
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 10, category: 'x' });
    const tool = findTool('update_expenses')!;
    const args = parseArgs(tool, { ids: [e.id], patch: { amount: 20 } });
    expect(tool.kind === 'write' && tool.preview?.(args, ctx)).toMatchObject({ before: [{ id: e.id, amount: 10 }] });
  });

  it('attaches message images and deletes them with the expense', () => {
    const ctx = testCtx();
    const img = newAttachmentId();
    saveAttachment(ctx.db, ctx.dir, { id: img, bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId: 1 });
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 10, category: 'x', attachment_ids: [img] });
    expect(ctx.db.prepare('SELECT owner_type, owner_id FROM attachments WHERE id = ?').get(img)).toEqual({ owner_type: 'expense', owner_id: e.id });
    expect(callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28' }).items[0].attachment_ids).toBe(img);
    callTool(ctx, 'delete_expenses', { ids: [e.id] });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
  });

  it('updates and deletes', () => {
    const ctx = testCtx();
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 10, category: 'x' });
    callTool(ctx, 'update_expenses', { ids: [e.id], patch: { amount: 20 } });
    expect(callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28' }).items[0].amount).toBe(20);
    callTool(ctx, 'delete_expenses', { ids: [e.id] });
    expect(callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28' }).items).toEqual([]);
  });
});
