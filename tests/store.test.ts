import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import { UserError } from '../src/main/errors';
import {
  addMessage,
  createAction,
  createConversation,
  deleteConversation,
  finishAction,
  getMessages,
  listActions,
  listConversations,
  pruneEmptyConversations,
  renameConversation,
  setTitleIfNew,
} from '../src/main/store';
import { testDb } from './helpers';

describe('store', () => {
  it('round-trips messages as JSON and titles new conversations once', () => {
    const { db } = testDb();
    const c = createConversation(db);
    addMessage(db, c, { role: 'user', content: 'Hôm nay có gì?', attachment_ids: ['abc12345'] });
    setTitleIfNew(db, c, 'Hôm nay có gì?');
    setTitleIfNew(db, c, 'khác');
    expect(getMessages(db, c)[0]).toMatchObject({ role: 'user', content: 'Hôm nay có gì?', attachment_ids: ['abc12345'] });
    expect(listConversations(db)[0].title).toBe('Hôm nay có gì?');
  });

  it('renames a conversation: trims, collapses spaces, caps at 100 code points, rejects empty', () => {
    const { db } = testDb();
    const c = createConversation(db);
    const updatedAt = listConversations(db)[0].updated_at;
    renameConversation(db, c, '  Kế   hoạch  tuần  ');
    expect(listConversations(db)[0].title).toBe('Kế hoạch tuần');
    renameConversation(db, c, '😀'.repeat(120));
    expect(listConversations(db)[0].title).toBe('😀'.repeat(100)); // code points, not UTF-16 units
    renameConversation(db, c, 'a'.repeat(120));
    expect(listConversations(db)[0].title).toBe('a'.repeat(100));
    expect(() => renameConversation(db, c, ' \n ')).toThrow(UserError);
    setTitleIfNew(db, c, 'auto'); // a renamed conversation is never auto-titled
    expect(listConversations(db)[0]).toMatchObject({ title: 'a'.repeat(100), updated_at: updatedAt }); // rename must not reorder
  });

  it('titles whitespace-only text as an image and cuts at 40 code points', () => {
    const { db } = testDb();
    const title = (text: string) => {
      const c = createConversation(db);
      addMessage(db, c, { role: 'user', content: text }); // else the next call reuses this empty conversation
      setTitleIfNew(db, c, text);
      return listConversations(db).find((r) => r.id === c)?.title;
    };
    expect(title(' \n\t ')).toBe('Ảnh');
    expect(title('a'.repeat(50))).toBe('a'.repeat(40));
    expect(title(`${'a'.repeat(39)}😀b`)).toBe(`${'a'.repeat(39)}😀`);
  });

  it('lists the most recently updated conversation first', () => {
    const { db } = testDb();
    const older = createConversation(db);
    addMessage(db, older, { role: 'user', content: 'a' });
    const newer = createConversation(db);
    db.exec("UPDATE conversations SET updated_at = '2020-01-01T00:00:00.000Z'");
    expect(listConversations(db).map((r) => r.id)).toEqual([newer, older]);
    addMessage(db, older, { role: 'user', content: 'x' });
    expect(listConversations(db).map((r) => r.id)).toEqual([older, newer]);
  });

  it('tracks pending actions', () => {
    const { db } = testDb();
    const c = createConversation(db);
    const id = createAction(db, { conversation_id: c, message_id: null, tool_call_id: 't1', tool_name: 'create_task', args: { title: 'A' }, preview: null });
    expect(listActions(db, c, 'pending')).toMatchObject([{ id, args: { title: 'A' }, preview: null, result: null }]);
    finishAction(db, id, 'confirmed', { title: 'B' }, { ok: 1 });
    finishAction(db, id, 'cancelled', {}, null); // already resolved: ignored
    expect(listActions(db, c)[0]).toMatchObject({ status: 'confirmed', args: { title: 'B' }, result: { ok: 1 } });
  });

  it('deleting a conversation removes its messages, actions and message images, and nothing else', () => {
    const { db, dir } = testDb();
    const img = (ownerId: number) =>
      saveAttachment(db, dir, { id: newAttachmentId(), bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId });
    const other = createConversation(db);
    img(addMessage(db, other, { role: 'user', content: 'keep' }));
    const c = createConversation(db);
    img(addMessage(db, c, { role: 'user', content: 'x' }));
    createAction(db, { conversation_id: c, message_id: null, tool_call_id: 't', tool_name: 'x', args: {}, preview: null });
    deleteConversation(db, c);
    const count = (t: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
    expect([count('messages'), count('pending_actions'), count('attachments')]).toEqual([{ n: 1 }, { n: 0 }, { n: 1 }]);
    expect(listConversations(db).map((r) => r.id)).toEqual([other]);
  });

  it('reuses the newest empty conversation', () => {
    const { db } = testDb();
    const c = createConversation(db);
    expect(createConversation(db)).toBe(c);
    addMessage(db, c, { role: 'user', content: 'x' });
    expect(createConversation(db)).not.toBe(c);
  });

  it('prunes conversations without messages', () => {
    const { db } = testDb();
    db.exec('INSERT INTO conversations DEFAULT VALUES'); // createConversation would reuse it
    const kept = Number(db.prepare('INSERT INTO conversations DEFAULT VALUES').run().lastInsertRowid);
    addMessage(db, kept, { role: 'user', content: 'x' });
    pruneEmptyConversations(db);
    expect(listConversations(db).map((c) => c.id)).toEqual([kept]);
  });

  it('keeps a renamed empty conversation: not reused, not pruned', () => {
    const { db } = testDb();
    const named = createConversation(db);
    renameConversation(db, named, 'Plan');
    const fresh = createConversation(db);
    expect(fresh).not.toBe(named);
    pruneEmptyConversations(db);
    expect(listConversations(db).map((c) => c.id)).toEqual([named]);
  });
});
