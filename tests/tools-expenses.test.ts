import { findTool, parseArgs } from '../src/main/tools';
import type { ExpenseList, ExpenseRow } from '../src/shared/types';
import { callTool, testCtx } from './helpers';

describe('expense tools', () => {
  it('defaults to today and VND', () => {
    const ctx = testCtx();
    const e = callTool<ExpenseRow>(ctx, 'create_expense', { amount: 45_000, category: 'ăn uống' });
    expect(e).toMatchObject({ amount: 45_000, currency: 'VND', spent_at: '2026-09-28' });
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
    expect(r.totals).toEqual(
      expect.arrayContaining([
        { currency: 'USD', total: 1300 },
        { currency: 'VND', total: 10_000 },
      ])
    );
    expect(r.totals).toHaveLength(2);
  });

  it('filters by category ignoring case', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_expense', { amount: 45_000, category: 'Ăn uống' });
    callTool(ctx, 'create_expense', { amount: 30_000, category: 'đi lại' });
    const r = callTool<ExpenseList>(ctx, 'list_expenses', { from: '2026-09-28', to: '2026-09-28', category: 'ăn uống' });
    expect(r.items.map((e) => e.amount)).toEqual([45_000]);
    expect(r.totals).toEqual([{ currency: 'VND', total: 45_000 }]);
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
