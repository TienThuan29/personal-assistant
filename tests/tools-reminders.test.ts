import type { ReminderRow, TaskRow } from '../src/shared/types';
import { callTool, testCtx } from './helpers';

describe('reminder tools', () => {
  it('stores local times as UTC ISO', () => {
    const ctx = testCtx();
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'Gọi mẹ', remind_at: '2026-09-28T15:00' });
    expect(r.remind_at).toBe(new Date(2026, 8, 28, 15, 0).toISOString());
    expect(r.status).toBe('pending');
  });

  it('converts offset inputs to UTC ISO', () => {
    const ctx = testCtx();
    for (const remind_at of ['2026-09-29T09:00+07:00', '2026-09-29T02:00Z']) {
      const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at });
      expect(r.remind_at).toBe('2026-09-29T02:00:00.000Z');
    }
  });

  it('requires a time, not a bare date', () => {
    const ctx = testCtx();
    expect(() => callTool(ctx, 'create_reminder', { message: 'x', remind_at: '2026-09-29' })).toThrow(/có giờ/);
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    expect(() => callTool(ctx, 'update_reminders', { ids: [r.id], patch: { remind_at: '2026-09-29' } })).toThrow(/có giờ/);
  });

  it('rejects past times and unknown tasks', () => {
    const ctx = testCtx();
    expect(() => callTool(ctx, 'create_reminder', { message: 'x', remind_at: '2026-09-28T08:00' })).toThrow(/đã qua/);
    expect(() => callTool(ctx, 'create_reminder', { message: 'x', remind_at: '2026-09-28T09:00' })).toThrow(/đã qua/);
    expect(() => callTool(ctx, 'create_reminder', { message: 'x', remind_at: '2026-09-28T10:00', task_id: 42 })).toThrow(/#42/);
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', { status: 'all' })).toEqual([]);
  });

  it('date-only bounds cover whole local days', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-29T23:30' });
    callTool(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-30T08:00' });
    const rows = callTool<ReminderRow[]>(ctx, 'list_reminders', { from: '2026-09-29', to: '2026-09-29' });
    expect(rows.map((r) => r.message)).toEqual(['A']);
  });

  it('datetime bounds: from inclusive, to exclusive', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    callTool(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-28T11:00' });
    const rows = callTool<ReminderRow[]>(ctx, 'list_reminders', { from: '2026-09-28T10:00', to: '2026-09-28T11:00' });
    expect(rows.map((r) => r.message)).toEqual(['A']);
  });

  it('lists pending by default, all statuses on request, sorted by time', () => {
    const ctx = testCtx();
    const b = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-28T12:00' });
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    callTool(ctx, 'update_reminders', { ids: [b.id], patch: { status: 'dismissed' } });
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', {}).map((r) => r.message)).toEqual(['A']);
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', { status: 'all' }).map((r) => r.message)).toEqual(['A', 'B']);
  });

  it('rescheduling a fired reminder makes it pending again', () => {
    const ctx = testCtx();
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    ctx.db.prepare("UPDATE reminders SET status = 'fired' WHERE id = ?").run(r.id);
    callTool(ctx, 'update_reminders', { ids: [r.id], patch: { remind_at: '2026-09-28T11:00' } });
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', {})[0]).toMatchObject({ id: r.id, status: 'pending' });
  });

  it('only dismissed can be set directly; reactivate by rescheduling', () => {
    const ctx = testCtx();
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    for (const status of ['pending', 'fired']) {
      expect(() => callTool(ctx, 'update_reminders', { ids: [r.id], patch: { status } })).toThrow(/dismissed/);
    }
    callTool(ctx, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } });
    callTool(ctx, 'update_reminders', { ids: [r.id], patch: { remind_at: '2026-09-28T11:00' } });
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', {})[0]).toMatchObject({ id: r.id, status: 'pending' });
  });

  it('rejects rescheduling into the past, empty patches and unknown ids', () => {
    const ctx = testCtx();
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    expect(() => callTool(ctx, 'update_reminders', { ids: [r.id], patch: { remind_at: '2026-09-28T08:00' } })).toThrow(/đã qua/);
    expect(() => callTool(ctx, 'update_reminders', { ids: [r.id], patch: {} })).toThrow(/rỗng/);
    expect(() => callTool(ctx, 'update_reminders', { ids: [r.id, 99], patch: { message: 'B' } })).toThrow(/#99/);
    expect(() => callTool(ctx, 'delete_reminders', { ids: [99] })).toThrow(/#99/);
  });

  it('deletes reminders', () => {
    const ctx = testCtx();
    const r = callTool<ReminderRow>(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00' });
    expect(callTool(ctx, 'delete_reminders', { ids: [r.id] })).toEqual({ deleted: [r.id] });
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', { status: 'all' })).toEqual([]);
  });

  it('deleting a task deletes its reminders (FK cascade)', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A' });
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T10:00', task_id: t.id });
    callTool(ctx, 'delete_tasks', { ids: [t.id] });
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', { status: 'all' })).toEqual([]);
  });
});
