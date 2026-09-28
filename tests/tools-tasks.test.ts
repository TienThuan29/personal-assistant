import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import { findTool, parseArgs } from '../src/main/tools';
import { updateRows } from '../src/main/tools/common';
import type { TaskRow } from '../src/shared/types';
import { callTool, testCtx } from './helpers';

describe('task tools', () => {
  it('creates a task with defaults', () => {
    const ctx = testCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'Nộp báo cáo', due_date: '2026-09-28' });
    expect(t).toMatchObject({ title: 'Nộp báo cáo', category: 'personal', priority: 2, status: 'todo', due_date: '2026-09-28' });
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
