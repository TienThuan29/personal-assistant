import { newAttachmentId, saveAttachment } from '../src/main/attachments';
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

  it('tracks pending actions', () => {
    const { db } = testDb();
    const c = createConversation(db);
    const id = createAction(db, { conversation_id: c, tool_call_id: 't1', tool_name: 'create_task', args: { title: 'A' }, preview: null });
    expect(listActions(db, c, 'pending')).toMatchObject([{ id, args: { title: 'A' }, preview: null, result: null }]);
    finishAction(db, id, 'confirmed', { title: 'B' }, { ok: 1 });
    expect(listActions(db, c)[0]).toMatchObject({ status: 'confirmed', args: { title: 'B' }, result: { ok: 1 } });
  });

  it('deleting a conversation removes its messages, actions and message images', () => {
    const { db, dir } = testDb();
    const c = createConversation(db);
    const m = addMessage(db, c, { role: 'user', content: 'x' });
    saveAttachment(db, dir, { id: newAttachmentId(), bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId: m });
    createAction(db, { conversation_id: c, tool_call_id: 't', tool_name: 'x', args: {}, preview: null });
    deleteConversation(db, c);
    for (const t of ['messages', 'pending_actions', 'attachments']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
  });

  it('prunes conversations without messages', () => {
    const { db } = testDb();
    createConversation(db);
    const kept = createConversation(db);
    addMessage(db, kept, { role: 'user', content: 'x' });
    pruneEmptyConversations(db);
    expect(listConversations(db).map((c) => c.id)).toEqual([kept]);
  });
});
