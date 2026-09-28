import { callTool, NOW, testCtx } from './helpers';

type Overview = { today: string; tasks_today: unknown[]; overdue: unknown[]; reminders_today: unknown[]; spent_today: unknown[] };
type SqlResult = { rows: Record<string, unknown>[]; truncated?: boolean };

describe('get_today_overview', () => {
  it('splits today vs overdue and sums today spending', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_task', { title: 'hôm nay', due_date: '2026-09-28' });
    callTool(ctx, 'create_task', { title: 'trễ', due_date: '2026-09-20' });
    callTool(ctx, 'create_task', { title: 'mai', due_date: '2026-09-29' });
    callTool(ctx, 'create_reminder', { message: 'r1', remind_at: '2026-09-28T20:00' });
    callTool(ctx, 'create_reminder', { message: 'r2', remind_at: '2026-09-29T08:00' });
    callTool(ctx, 'create_expense', { amount: 30_000, category: 'ăn uống' });
    const o = callTool<Overview>(ctx, 'get_today_overview', {});
    expect(o.today).toBe('2026-09-28');
    expect(o.tasks_today).toMatchObject([{ title: 'hôm nay' }]);
    expect(o.overdue).toMatchObject([{ title: 'trễ' }]);
    expect(o.reminders_today).toMatchObject([{ message: 'r1' }]);
    expect(o.spent_today).toEqual([{ currency: 'VND', total: 30_000 }]);
  });

  it('skips done tasks, other days and non-pending reminders; keeps local-day edges; sums per currency', () => {
    let now = new Date(2026, 8, 27, 0, 0); // reminders must be created in the future
    const ctx = testCtx(() => now);
    const { id } = callTool<{ id: number }>(ctx, 'create_task', { title: 'xong', due_date: '2026-09-28' });
    callTool(ctx, 'update_tasks', { ids: [id], patch: { status: 'done' } });
    callTool(ctx, 'create_reminder', { message: 'đầu ngày', remind_at: '2026-09-28T00:00' });
    callTool(ctx, 'create_reminder', { message: 'cuối ngày', remind_at: '2026-09-28T23:59' });
    callTool(ctx, 'create_reminder', { message: 'hôm qua', remind_at: '2026-09-27T23:59' });
    callTool(ctx, 'create_reminder', { message: 'đã hiện', remind_at: '2026-09-28T10:00' });
    callTool(ctx, 'create_reminder', { message: 'bỏ qua', remind_at: '2026-09-28T11:00' });
    ctx.db.prepare("UPDATE reminders SET status = 'fired' WHERE message = 'đã hiện'").run();
    ctx.db.prepare("UPDATE reminders SET status = 'dismissed' WHERE message = 'bỏ qua'").run();
    callTool(ctx, 'create_expense', { amount: 10_000, category: 'ăn uống', spent_at: '2026-09-27' });
    callTool(ctx, 'create_expense', { amount: 20_000, category: 'ăn uống', spent_at: '2026-09-28' });
    callTool(ctx, 'create_expense', { amount: 5_000, category: 'đi lại', spent_at: '2026-09-28' });
    callTool(ctx, 'create_expense', { amount: 350, currency: 'USD', category: 'ăn uống', spent_at: '2026-09-28' });
    now = NOW;
    const o = callTool<Overview>(ctx, 'get_today_overview', {});
    expect(o.tasks_today).toEqual([]);
    expect(o.overdue).toEqual([]);
    expect(o.reminders_today).toMatchObject([{ message: 'đầu ngày' }, { message: 'cuối ngày' }]);
    expect(o.spent_today).toEqual([
      { currency: 'USD', total: 350 },
      { currency: 'VND', total: 25_000 },
    ]);
  });
});

describe('query_readonly_sql', () => {
  it('runs SELECT and WITH, sees committed writes', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_task', { title: 'A' });
    expect(callTool<SqlResult>(ctx, 'query_readonly_sql', { sql: 'SELECT COUNT(*) AS n FROM tasks;' }).rows).toEqual([{ n: 1 }]);
    expect(callTool<SqlResult>(ctx, 'query_readonly_sql', { sql: '  with t AS (SELECT title FROM tasks) select * from t' }).rows).toEqual([
      { title: 'A' },
    ]);
  });

  it('accepts a trailing line comment', () => {
    const ctx = testCtx();
    expect(callTool<SqlResult>(ctx, 'query_readonly_sql', { sql: 'SELECT 1 AS n -- one' }).rows).toEqual([{ n: 1 }]);
  });

  it('refuses anything that writes', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_task', { title: 'A' });
    expect(() => callTool(ctx, 'query_readonly_sql', { sql: 'DELETE FROM tasks' })).toThrow(/SELECT/);
    expect(() => callTool(ctx, 'query_readonly_sql', { sql: 'WITH x AS (SELECT 1) DELETE FROM tasks' })).toThrow();
    callTool(ctx, 'query_readonly_sql', { sql: 'SELECT 1); DELETE FROM tasks; SELECT (1' }); // only the first statement is prepared
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 });
  });

  it('caps rows at 200', () => {
    const ctx = testCtx();
    const sql = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT i FROM n';
    const r = callTool<SqlResult>(ctx, 'query_readonly_sql', { sql });
    expect(r.rows).toHaveLength(200);
    expect(r.truncated).toBe(true);
  });

  it('caps rows even when a trailing statement drops the LIMIT', () => {
    const ctx = testCtx();
    const sql = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT i FROM n); SELECT (1';
    const r = callTool<SqlResult>(ctx, 'query_readonly_sql', { sql });
    expect(r.rows).toHaveLength(200);
    expect(r.truncated).toBe(true);
    expect(callTool<SqlResult>(ctx, 'query_readonly_sql', { sql: 'SELECT 1 AS n' }).rows).toEqual([{ n: 1 }]);
  });

  it('cuts long strings and hides blobs', () => {
    const ctx = testCtx();
    const r = callTool<SqlResult>(ctx, 'query_readonly_sql', { sql: "SELECT printf('%.*c', 2000, 'x') AS s, zeroblob(10) AS b, 'ngắn' AS t" });
    expect(r.rows).toEqual([{ s: `${'x'.repeat(500)}…`, b: '[blob 10 bytes]', t: 'ngắn' }]);
  });
});
