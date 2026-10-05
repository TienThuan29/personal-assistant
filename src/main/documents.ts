// PDF batch runs (docs/pdf-batch-reasoning-design.md). Pure helpers: the loop that uses them is in docrun.ts.
import { batchRanges, MAX_PDF_PAGES } from '../shared/pdf';
import type { BatchInfo, ChatMessage, PdfInput } from '../shared/types';
import { newAttachmentId, saveAttachment } from './attachments';
import { type Db, tx } from './db';
import { UserError } from './errors';
import { addMessage } from './store';

/** What `runWithDocuments` does next, read from the stored messages so Retry and a restart continue where the run stopped. */
export type Step =
  | { kind: 'normal' } // not in a PDF run, or the run is over: an ordinary turn
  | { kind: 'rerun' } // the last batch/final message has no reply yet (error, Stop): run that one again
  | { kind: 'batch'; part: number; parts: number }
  | { kind: 'final' };

const isRunMessage = (m: ChatMessage): boolean => m.role === 'user' && !!(m.batch || m.final);

export function nextStep(msgs: ChatMessage[]): Step {
  const p = msgs.findLastIndex((m) => m.role === 'user' && !!m.document);
  const doc = p >= 0 && msgs[p].role === 'user' ? msgs[p].document : undefined;
  if (!doc) return { kind: 'normal' };
  const after = msgs.slice(p + 1);
  // A message the user typed afterwards leaves the run behind.
  if (after.some((m) => m.role === 'user' && !m.batch && !m.final)) return { kind: 'normal' };
  const last = msgs[msgs.length - 1];
  if (isRunMessage(last)) return { kind: 'rerun' };
  if (after.some((m) => m.role === 'user' && m.final)) return { kind: 'normal' }; // finished (or resuming after a card)
  const parts = batchRanges(doc.pages.length).length;
  const done = after.filter((m) => m.role === 'user' && m.batch).length;
  return done < parts ? { kind: 'batch', part: done + 1, parts } : { kind: 'final' };
}

/** Index of the PDF message the current run started with, or -1 when the last user message is not a batch/final one. */
export function runStart(msgs: ChatMessage[]): number {
  const lastUser = msgs.findLast((m) => m.role === 'user');
  return lastUser && isRunMessage(lastUser) ? msgs.findLastIndex((m) => m.role === 'user' && !!m.document) : -1;
}

/** The user's question of the run (a PDF sent with no text means "summarise it"). */
export function questionOf(msgs: ChatMessage[]): string {
  const m = msgs.findLast((x) => x.role === 'user' && !!x.document);
  return (m?.role === 'user' && m.content.trim()) || 'Summarize this document.';
}

export const batchPrompt = (b: BatchInfo, question: string): string =>
  `[PDF "${b.name}", part ${b.part} of ${b.parts}: pages ${b.from}-${b.to} of ${b.total}]\n` +
  `The user's request: ${question}\n` +
  'Read these pages and write concise notes that matter for the request (key facts, figures, names, section titles; say which page). ' +
  'Do not answer the whole request yet and do not call tools: a final step will combine the notes of all parts.';

export const finalPrompt = (name: string, parts: number, question: string): string =>
  `[PDF "${name}": all ${parts} parts have been read, your notes are above]\n` +
  `Now answer the user's request completely, using all the notes: ${question}`;

/** The text a PDF message becomes for the model: the question plus what the pages are (they arrive in the parts that follow). */
export const documentLabel = (m: { content: string; document: { name: string; pages: string[] } }, textOnly: boolean): string =>
  [
    m.content,
    `[PDF "${m.document.name}", ${m.document.pages.length} pages${textOnly ? ' (this model cannot see images, so the pages cannot be read)' : ', read in the parts that follow'}]`,
  ]
    .filter(Boolean)
    .join('\n');

/** The renderer's PDF payload, checked: a name, 1 to MAX_PDF_PAGES pages, every page a valid image (`toJpeg` throws a UserError). */
export function checkDocument(raw: unknown, toJpeg: (bytes: unknown) => Buffer): { name: string; pages: Buffer[] } {
  const d = raw as Partial<PdfInput> | null;
  if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 200 || !Array.isArray(d.pages) || !d.pages.length)
    throw new UserError('invalidDocument');
  if (d.pages.length > MAX_PDF_PAGES) throw new UserError('tooManyPages', { max: MAX_PDF_PAGES });
  return { name: d.name.trim(), pages: d.pages.map((p) => toJpeg(p?.bytes)) };
}

/** Saves the user's PDF message and its pages as attachments of that message. Returns the message id. */
export function addDocumentMessage(db: Db, dir: string, conversationId: number, question: string, doc: { name: string; pages: Buffer[] }): number {
  const ids = doc.pages.map(() => newAttachmentId());
  return tx(db, () => {
    const messageId = addMessage(db, conversationId, { role: 'user', content: question, document: { name: doc.name, pages: ids } });
    doc.pages.forEach((bytes, i) => saveAttachment(db, dir, { id: ids[i], bytes, mime: 'image/jpeg', ownerType: 'message', ownerId: messageId }));
    return messageId;
  });
}
