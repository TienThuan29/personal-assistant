import { z } from 'zod/v4';
import type { NoteRow } from '../../shared/types';
import {
  attachmentIds,
  attachmentsCol,
  attachTo,
  date,
  deleteRows,
  getRows,
  ids,
  readTool,
  requireRows,
  toInstant,
  updateRows,
  where,
  writeTool,
} from './common';

const kind = z.enum(['note', 'journal']).describe("'note' = note, 'journal' = journal entry");

const phrase = (w: string): string => `"${w.replace(/"/g, '""')}"*`;

/**
 * FTS5 query from free text: split on anything but letters/digits/marks, each word quoted and prefix-matched.
 * unicode61 does not fold đ to d, so a word starting with d/đ matches both (đ only starts a Vietnamese syllable).
 */
export const ftsQuery = (text: string): string =>
  text
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => (/^[dđ]/iu.test(w) ? `(${phrase(`d${w.slice(1)}`)} OR ${phrase(`đ${w.slice(1)}`)})` : phrase(w)))
    .join(' AND ');

export const noteTools = [
  readTool({
    name: 'search_notes',
    description:
      'Search notes/journal entries by keyword and creation date range. Leave query empty to get the newest. Returns excerpts with matches wrapped in ⟦ ⟧; read the full text with get_notes.',
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe('Keyword to find in title and body, ignoring diacritics and case, also matching word beginnings; every word must be present'),
      kind: kind.optional(),
      from: date.optional().describe('Created on or after this date (inclusive)'),
      to: date.optional().describe('Created on or before this date (inclusive)'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of results (1-100)'),
    }),
    run: (a, { db }) => {
      const q = a.query ? ftsQuery(a.query) || undefined : undefined;
      if (a.query?.trim() && !q) return []; // punctuation only: nothing can match
      const w = where([
        ['notes_fts MATCH :q', 'q', q],
        ['n.kind = :kind', 'kind', a.kind],
        ['n.created_at >= :from', 'from', a.from ? toInstant(a.from, 'start') : undefined],
        ['n.created_at < :to', 'to', a.to ? toInstant(a.to, 'end') : undefined],
      ]);
      const source = q ? 'notes_fts JOIN notes n ON n.id = notes_fts.rowid' : 'notes n';
      const snippet = q ? "snippet(notes_fts, 1, '⟦', '⟧', '…', 16)" : 'substr(n.body, 1, 300)';
      return db
        .prepare(
          `SELECT n.id, n.kind, n.title, ${snippet} AS snippet, n.created_at, n.updated_at, ${attachmentsCol('note', 'n.id')}
           FROM ${source} ${w.sql} ORDER BY ${q ? 'rank' : 'n.created_at DESC'} LIMIT :limit`
        )
        .all({ ...w.params, limit: a.limit });
    },
  }),

  readTool({
    name: 'get_notes',
    description: 'Read the full text of notes by ID (after finding them with search_notes).',
    schema: z.object({ ids }),
    run: (a, { db }) => getRows<NoteRow>(db, 'notes', a.ids),
  }),

  writeTool({
    name: 'create_note',
    description: 'Create a note or a journal entry.',
    schema: z.object({ kind: kind.default('note'), title: z.string().optional(), body: z.string().min(1), attachment_ids: attachmentIds }),
    apply: (a, { db }) => {
      const r = db.prepare('INSERT INTO notes (kind, title, body) VALUES (?, ?, ?)').run(a.kind, a.title ?? null, a.body);
      const id = Number(r.lastInsertRowid);
      attachTo(db, 'note', id, a.attachment_ids);
      return getRows<NoteRow>(db, 'notes', [id])[0];
    },
  }),

  writeTool({
    name: 'update_notes',
    description: 'Update notes/journal entries.',
    schema: z.object({
      ids,
      patch: z
        .object({ kind: kind.optional(), title: z.string().nullable().optional(), body: z.string().min(1).optional() })
        .refine((p) => Object.keys(p).length > 0, 'errors:emptyPatch'),
    }),
    preview: (a, { db }) => ({ before: requireRows<NoteRow>(db, 'notes', a.ids) }),
    apply: (a, { db, now }) => {
      requireRows(db, 'notes', a.ids);
      updateRows(db, 'notes', a.ids, a.patch, { updated_at: now().toISOString() });
      return { updated: getRows<NoteRow>(db, 'notes', a.ids) };
    },
  }),

  writeTool({
    name: 'delete_notes',
    description: 'Permanently delete notes/journal entries (and their images).',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<NoteRow>(db, 'notes', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'notes', a.ids);
      deleteRows(db, 'notes', 'note', a.ids);
      return { deleted: a.ids };
    },
  }),
];
