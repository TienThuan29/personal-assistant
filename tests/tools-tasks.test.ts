import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import { findTool, parseArgs } from '../src/main/tools';
import { updateRows } from '../src/main/tools/common';
import type { TaskRow } from '../src/shared/types';
import { callTool, NOW, testCtx } from './helpers';

describe('task tools', () => {
  it('creates a task with defaults', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'Nộp báo cáo', due_date: '2026-09-28' });
    expect(t).toMatchObject({ title: 'Nộp báo cáo', category: 'personal', priority: 2, status: 'todo', due_date: '2026-09-28' });
  });

  it('snaps a category to its existing spelling and filters ignoring case and accents', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_task', { title: 'A', category: 'Gia đình' });
    const b = callTool<TaskRow>(ctx, 'create_task', { title: 'B', category: ' gia dinh ' });
    expect(b.category).toBe('Gia đình');
    const c = callTool<TaskRow>(ctx, 'create_task', { title: 'C', category: 'work' });
    callTool(ctx, 'update_tasks', { ids: [c.id], patch: { category: 'GIA DINH' } });
    expect(ctx.db.prepare('SELECT DISTINCT category FROM tasks').all()).toEqual([{ category: 'Gia đình' }]);
    expect(callTool<TaskRow[]>(ctx, 'list_tasks', { category: 'gia dinh' }).map((t) => t.title)).toEqual(['A', 'B', 'C']);
    // Updating every row of a category renames it.
    callTool(ctx, 'update_tasks', { ids: [1, 2, 3], patch: { category: 'Nhà' } });
    expect(ctx.db.prepare('SELECT DISTINCT category FROM tasks').all()).toEqual([{ category: 'Nhà' }]);
  });

  it('lists by date range and category', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_task', { title: 'A', due_date: '2026-09-28', category: 'work' });
    callTool(ctx, 'create_task', { title: 'B', due_date: '2026-09-28' });
    callTool(ctx, 'create_task', { title: 'C', due_date: '2026-09-29', category: 'work' });
    const rows = callTool<TaskRow[]>(ctx, 'list_tasks', { from: '2026-09-28', to: '2026-09-28', category: 'work' });
    expect(rows.map((r) => r.title)).toEqual(['A']);
  });

  it('rejects malformed dates with a readable message', () => {
    expect(() => parseArgs(findTool('create_task')!, { title: 'x', due_date: '28/09' })).toThrow(/YYYY-MM-DD/);
  });

  it('bulk-reschedules', () => {
    const ctx = testCtx();
    const a = callTool<TaskRow>(ctx, 'create_task', { title: 'A', due_date: '2026-09-28' });
    const b = callTool<TaskRow>(ctx, 'create_task', { title: 'B', due_date: '2026-09-28' });
    callTool(ctx, 'update_tasks', { ids: [a.id, b.id], patch: { due_date: '2026-09-29' } });
    expect(callTool<TaskRow[]>(ctx, 'list_tasks', { from: '2026-09-29' }).map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('completing a recurring task spawns the next one and clears the rule on the old one', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'Tập gym', due_date: '2026-09-28', recurrence: 'weekly:1,3' });
    const r = callTool<{ spawned: TaskRow[] }>(ctx, 'update_tasks', { ids: [t.id], patch: { status: 'done' } });
    expect(r.spawned[0]).toMatchObject({ title: 'Tập gym', due_date: '2026-09-30', recurrence: 'weekly:1,3', status: 'todo' });
    const [done] = callTool<TaskRow[]>(ctx, 'list_tasks', { status: 'done' });
    expect(done).toMatchObject({ id: t.id, recurrence: null });
    expect(done.completed_at).not.toBeNull();
  });

  it('completing twice spawns only once', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A', due_date: '2026-09-28', recurrence: 'daily' });
    callTool(ctx, 'update_tasks', { ids: [t.id], patch: { status: 'done' } });
    const r = callTool<{ spawned: TaskRow[] }>(ctx, 'update_tasks', { ids: [t.id], patch: { status: 'done' } });
    expect(r.spawned).toEqual([]);
    expect(callTool<TaskRow[]>(ctx, 'list_tasks', { status: 'all' })).toHaveLength(2);
  });

  it('bulk-completing spawns only for recurring tasks', () => {
    const ctx = testCtx();
    const a = callTool<TaskRow>(ctx, 'create_task', { title: 'A', due_date: '2026-09-28', recurrence: 'daily' });
    const b = callTool<TaskRow>(ctx, 'create_task', { title: 'B', due_date: '2026-09-28' });
    const r = callTool<{ spawned: TaskRow[] }>(ctx, 'update_tasks', { ids: [a.id, b.id], patch: { status: 'done' } });
    expect(r.spawned.map((t) => [t.title, t.due_date])).toEqual([['A', '2026-09-29']]);
  });

  it('spawns from today when the task has no due date or is overdue', () => {
    const ctx = testCtx();
    const a = callTool<TaskRow>(ctx, 'create_task', { title: 'A', recurrence: 'daily' });
    const b = callTool<TaskRow>(ctx, 'create_task', { title: 'B', due_date: '2026-09-01', recurrence: 'daily' });
    const r = callTool<{ spawned: TaskRow[] }>(ctx, 'update_tasks', { ids: [a.id, b.id], patch: { status: 'done' } });
    expect(r.spawned.map((t) => t.due_date)).toEqual(['2026-09-29', '2026-09-29']);
  });

  it('cancelling a recurring task skips to the next occurrence', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A', due_date: '2026-09-28', recurrence: 'weekly:1,3' });
    const r = callTool<{ updated: TaskRow[]; spawned: TaskRow[] }>(ctx, 'update_tasks', { ids: [t.id], patch: { status: 'cancelled' } });
    expect(r.spawned[0]).toMatchObject({ due_date: '2026-09-30', recurrence: 'weekly:1,3', status: 'todo' });
    expect(r.updated[0]).toMatchObject({ status: 'cancelled', recurrence: null, completed_at: null });
  });

  it('spawns from the updated row', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A', due_date: '2026-09-28', recurrence: 'weekly:1,3' });
    const r = callTool<{ spawned: TaskRow[] }>(ctx, 'update_tasks', {
      ids: [t.id],
      patch: { status: 'done', title: 'B', recurrence: 'daily' },
    });
    expect(r.spawned[0]).toMatchObject({ title: 'B', due_date: '2026-09-29', recurrence: 'daily' });
  });

  it('keeps completed_at on re-complete and clears it on un-complete', () => {
    let now = NOW;
    const ctx = testCtx(() => now);
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A' });
    const done = (status: string) => callTool<{ updated: TaskRow[] }>(ctx, 'update_tasks', { ids: [t.id], patch: { status } }).updated[0];
    expect(done('done').completed_at).toBe(NOW.toISOString());
    now = new Date(2026, 8, 28, 10, 0);
    expect(done('done').completed_at).toBe(NOW.toISOString());
    expect(done('todo').completed_at).toBeNull();
    expect(done('done').completed_at).toBe(now.toISOString());
  });

  it('searches ignoring accents and case, with literal wildcards', () => {
    const ctx = testCtx();
    for (const title of ['Đi chợ', 'Họp', '50% off']) callTool(ctx, 'create_task', { title });
    const find = (query: string) => callTool<TaskRow[]>(ctx, 'list_tasks', { query }).map((r) => r.title);
    expect(find('di cho')).toEqual(['Đi chợ']);
    expect(find('ĐI')).toEqual(['Đi chợ']);
    expect(find('%')).toEqual(['50% off']);
  });

  it('refuses unknown ids and empty patches', () => {
    const ctx = testCtx();
    expect(() => callTool(ctx, 'update_tasks', { ids: [999], patch: { status: 'done' } })).toThrow(/#999/);
    expect(() => parseArgs(findTool('update_tasks')!, { ids: [1], patch: {} })).toThrow(/rỗng/);
  });

  it('updateRows refuses a patch with nothing to set', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A' });
    expect(() => updateRows(ctx.db, 'tasks', [t.id], { title: undefined })).toThrow('patch không được rỗng');
  });

  it('preview shows the current rows', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A' });
    const tool = findTool('delete_tasks')!;
    expect(tool.kind === 'write' && tool.preview?.({ ids: [t.id] }, ctx)).toMatchObject({ before: [{ id: t.id, title: 'A' }] });
  });

  it('attaches message images and deletes them with the task', () => {
    const ctx = testCtx();
    const img = newAttachmentId();
    saveAttachment(ctx.db, ctx.dir, { id: img, bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId: 1 });
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'A', attachment_ids: [img] });
    expect(callTool<TaskRow[]>(ctx, 'list_tasks', {})[0].attachment_ids).toBe(img);
    callTool(ctx, 'delete_tasks', { ids: [t.id] });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
  });
});
