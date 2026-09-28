import type { ChatMessage, ConversationRow, PendingAction, StoredMessage } from '../shared/types';
import { type Db, tx } from './db';

const DEFAULT_TITLE = 'Hội thoại mới'; // must match the conversations.title default in migrations.ts
const NOW_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Reuses the newest conversation without messages, so "new chat" clicks don't pile up empty ones. */
export function createConversation(db: Db): number {
  const empty = db
    .prepare('SELECT id FROM conversations c WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id) ORDER BY id DESC LIMIT 1')
    .get() as { id: number } | undefined;
  return empty ? empty.id : Number(db.prepare('INSERT INTO conversations DEFAULT VALUES').run().lastInsertRowid);
}

export const listConversations = (db: Db): ConversationRow[] =>
  db.prepare('SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC, id DESC').all() as unknown as ConversationRow[];

export function deleteConversation(db: Db, id: number): void {
  tx(db, () => {
    db.prepare(
      "DELETE FROM attachments WHERE owner_type = 'message' AND owner_id IN (SELECT id FROM messages WHERE conversation_id = ?)"
    ).run(id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id); // messages + pending_actions cascade
  });
}

export function pruneEmptyConversations(db: Db): void {
  db.prepare('DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM messages)').run();
}

export function setTitleIfNew(db: Db, id: number, text: string): void {
  const title = [...text.normalize('NFC').replace(/\s+/g, ' ').trim()].slice(0, 40).join('') || 'Ảnh'; // code points: never splits an emoji
  db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND title = ?').run(title, id, DEFAULT_TITLE);
}

export function addMessage(db: Db, conversationId: number, m: StoredMessage): number {
  const r = db
    .prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, m.role, JSON.stringify(m));
  db.prepare(`UPDATE conversations SET updated_at = ${NOW_ISO} WHERE id = ?`).run(conversationId);
  return Number(r.lastInsertRowid);
}

// ponytail: loads the full history each LLM round; add a tail query (ORDER BY id DESC LIMIT n) if long chats get slow
export function getMessages(db: Db, conversationId: number): ChatMessage[] {
  const rows = db.prepare('SELECT id, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId) as {
    id: number;
    content: string;
    created_at: string;
  }[];
  return rows.map((r) => ({ ...(JSON.parse(r.content) as StoredMessage), id: r.id, created_at: r.created_at }));
}

type ActionRow = Omit<PendingAction, 'args' | 'preview' | 'result'> & { args: string; preview: string; result: string | null };
const toAction = (r: ActionRow): PendingAction => ({
  ...r,
  args: JSON.parse(r.args),
  preview: JSON.parse(r.preview),
  result: r.result === null ? null : JSON.parse(r.result),
});

export function createAction(
  db: Db,
  a: { conversation_id: number; message_id: number | null; tool_call_id: string; tool_name: string; args: unknown; preview: unknown }
): number {
  return Number(
    db
      .prepare('INSERT INTO pending_actions (conversation_id, message_id, tool_call_id, tool_name, args, preview) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a.conversation_id, a.message_id, a.tool_call_id, a.tool_name, JSON.stringify(a.args), JSON.stringify(a.preview ?? null))
      .lastInsertRowid
  );
}

export function getAction(db: Db, id: number): PendingAction | undefined {
  const row = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(id) as ActionRow | undefined;
  return row && toAction(row);
}

export function listActions(db: Db, conversationId: number, status?: PendingAction['status']): PendingAction[] {
  const rows = (
    status
      ? db.prepare('SELECT * FROM pending_actions WHERE conversation_id = ? AND status = ? ORDER BY id').all(conversationId, status)
      : db.prepare('SELECT * FROM pending_actions WHERE conversation_id = ? ORDER BY id').all(conversationId)
  ) as unknown as ActionRow[];
  return rows.map(toAction);
}

export function finishAction(db: Db, id: number, status: 'confirmed' | 'cancelled', args: unknown, result: unknown): void {
  db.prepare("UPDATE pending_actions SET status = ?, args = ?, result = ? WHERE id = ? AND status = 'pending'").run(
    status,
    JSON.stringify(args),
    JSON.stringify(result ?? null),
    id
  );
}
