import { join } from 'node:path';
import { saveRecord } from '../src/main/save';
import type { NoteRow, ReminderRow, TaskRow } from '../src/shared/types';
import { callTool, NOW, tempDir, testCtx } from './helpers';

const IMG = new Uint8Array([1]); // saveRecord does not check image bytes

const saveCtx = (now?: () => Date) => ({ ...testCtx(now), attachmentsDir: join(tempDir(), 'att') });
const owners = (ctx: ReturnType<typeof saveCtx>) =>
  ctx.db.prepare('SELECT id, owner_type, owner_id FROM attachments ORDER BY owner_type, owner_id').all() as {
    id: string;
    owner_type: string;
    owner_id: number;
  }[];
const key = (k: string) => expect.objectContaining({ key: k });

describe('saveRecord', () => {
  it('creates a task with its images', () => {
    const ctx = saveCtx();
    const t = saveRecord(ctx, 'create_task', { title: 'Mua sữa' }, [IMG, IMG], undefined) as TaskRow;
    expect(t.title).toBe('Mua sữa');
    expect(owners(ctx).map((a) => [a.owner_type, a.owner_id])).toEqual([
      ['task', t.id],
      ['task', t.id],
    ]);
  });

  it('updates a note, adding one image and removing another', () => {
    const ctx = saveCtx();
    const n = saveRecord(ctx, 'create_note', { body: 'a' }, [IMG], []) as NoteRow;
    const [old] = owners(ctx);
    const saved = saveRecord(ctx, 'update_notes', { ids: [n.id], patch: { body: 'b' } }, [IMG], [old.id]) as NoteRow;
    expect(saved.body).toBe('b');
    const after = owners(ctx);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(old.id);
    expect(after[0]).toMatchObject({ owner_type: 'note', owner_id: n.id });
  });

  it("ignores removeIds of another record's images", () => {
    const ctx = saveCtx();
    const a = saveRecord(ctx, 'create_note', { body: 'a' }, [IMG], []) as NoteRow;
    const b = saveRecord(ctx, 'create_note', { body: 'b' }, [], []) as NoteRow;
    saveRecord(ctx, 'update_notes', { ids: [b.id], patch: {} }, [], [owners(ctx)[0].id]);
    expect(owners(ctx)).toMatchObject([{ owner_type: 'note', owner_id: a.id }]);
  });

  it('rejects tools outside the allowlist', () => {
    const ctx = saveCtx();
    expect(() => saveRecord(ctx, 'delete_tasks', { ids: [1] }, [], [])).toThrow(key('notAllowed'));
    expect(() => saveRecord(ctx, 'list_tasks', {}, [], [])).toThrow(key('notAllowed'));
    expect(() => saveRecord(ctx, 'toString', {}, [], [])).toThrow(key('notAllowed'));
  });

  it('saves one record at a time and validates the args shape', () => {
    const ctx = saveCtx();
    expect(() => saveRecord(ctx, 'update_tasks', { ids: [1, 2], patch: { title: 'x' } }, [], [])).toThrow(key('saveOneRecord'));
    expect(() => saveRecord(ctx, 'update_tasks', { patch: {} }, [], [])).toThrow(key('saveOneRecord'));
    expect(() => saveRecord(ctx, 'update_tasks', null, [], [])).toThrow(key('invalidValue'));
    expect(() => saveRecord(ctx, 'update_tasks', { ids: ['1'], patch: {} }, [], [])).toThrow(key('invalidId'));
    expect(() => saveRecord(ctx, 'update_tasks', { ids: [1], patch: {} }, [], 'x')).toThrow(key('invalidValue'));
    expect(() => saveRecord(ctx, 'update_tasks', { ids: [1], patch: {} }, [], [1])).toThrow(key('invalidValue'));
  });

  it('with an empty patch only adds images, and still requires the record', () => {
    const ctx = saveCtx();
    const t = callTool<TaskRow>(ctx, 'create_task', { title: 'a' });
    expect(saveRecord(ctx, 'update_tasks', { ids: [t.id], patch: {} }, [IMG], [])).toEqual(t);
    expect(owners(ctx)).toMatchObject([{ owner_type: 'task', owner_id: t.id }]);
    expect(() => saveRecord(ctx, 'update_tasks', { ids: [99], patch: {} }, [IMG], [])).toThrow(key('notFound'));
  });

  it('leaves no attachment row when the save fails', () => {
    const ctx = saveCtx();
    expect(() => saveRecord(ctx, 'update_tasks', { ids: [99], patch: { title: 'x' } }, [IMG, IMG], [])).toThrow(key('notFound'));
    expect(owners(ctx)).toEqual([]);
  });

  it('rejects images and removals on reminders', () => {
    const ctx = saveCtx();
    expect(() => saveRecord(ctx, 'create_reminder', { message: 'x', remind_at: '2026-09-29T09:00' }, [IMG], [])).toThrow(key('invalidValue'));
    expect(() => saveRecord(ctx, 'update_reminders', { ids: [1], patch: {} }, [], ['a'])).toThrow(key('invalidValue'));
  });

  it('edits only the message of a reminder that is already past', () => {
    let now = NOW;
    const ctx = saveCtx(() => now);
    const r = saveRecord(ctx, 'create_reminder', { message: 'a', remind_at: '2026-09-28T10:00' }, [], undefined) as ReminderRow;
    now = new Date(2026, 8, 28, 11, 0);
    const saved = saveRecord(ctx, 'update_reminders', { ids: [r.id], patch: { message: 'b' } }, [], undefined) as ReminderRow;
    expect(saved).toMatchObject({ message: 'b', remind_at: r.remind_at });
  });
});
