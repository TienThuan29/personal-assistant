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
  updateRows,
  where,
  writeTool,
} from './common';

const kind = z.enum(['note', 'journal']).describe("'note' ghi chú, 'journal' nhật ký");

const phrase = (w: string): string => `"${w.replace(/"/g, '""')}"*`;

/**
 * FTS5 query from free text: each word quoted (so no syntax errors) and prefix-matched.
 * unicode61 does not fold đ to d, so a word starting with d/đ matches both (đ only starts a Vietnamese syllable).
 */
export const ftsQuery = (text: string): string =>
  text
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => (/^[dđ]/iu.test(w) ? `(${phrase(`d${w.slice(1)}`)} OR ${phrase(`đ${w.slice(1)}`)})` : phrase(w)))
    .join(' AND ');

export const noteTools = [
  readTool({
    name: 'search_notes',
    description:
      'Tìm ghi chú/nhật ký theo từ khóa và khoảng ngày tạo. Bỏ trống query để lấy mới nhất. Trả về đoạn trích; đọc toàn văn bằng get_notes.',
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe('Từ khóa tìm trong tiêu đề và nội dung, không phân biệt dấu và hoa thường, khớp cả đầu từ; mọi từ phải có mặt'),
      kind: kind.optional(),
      from: date.optional().describe('Ngày tạo từ (tính cả ngày này)'),
      to: date.optional().describe('Ngày tạo đến (tính cả ngày này)'),
      limit: z.number().int().min(1).max(100).default(20).describe('Số kết quả tối đa (1-100)'),
    }),
    run: (a, { db }) => {
      const q = a.query ? ftsQuery(a.query) || undefined : undefined;
      const w = where([
        ['notes_fts MATCH :q', 'q', q],
        ['n.kind = :kind', 'kind', a.kind],
        ["date(n.created_at, 'localtime') >= :from", 'from', a.from],
        ["date(n.created_at, 'localtime') <= :to", 'to', a.to],
      ]);
      const source = q ? 'notes_fts JOIN notes n ON n.id = notes_fts.rowid' : 'notes n';
      const snippet = q ? "snippet(notes_fts, 1, '**', '**', '…', 16)" : 'substr(n.body, 1, 300)';
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
    description: 'Đọc toàn văn ghi chú theo ID (sau khi tìm bằng search_notes).',
    schema: z.object({ ids }),
    run: (a, { db }) => getRows<NoteRow>(db, 'notes', a.ids),
  }),

  writeTool({
    name: 'create_note',
    description: 'Tạo ghi chú hoặc nhật ký.',
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
    description: 'Sửa ghi chú/nhật ký.',
    schema: z.object({
      ids,
      patch: z
        .object({ kind: kind.optional(), title: z.string().nullable().optional(), body: z.string().min(1).optional() })
        .refine((p) => Object.keys(p).length > 0, 'patch không được rỗng'),
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
    description: 'Xóa hẳn ghi chú/nhật ký (kèm ảnh).',
    schema: z.object({ ids }),
    preview: (a, { db }) => ({ before: requireRows<NoteRow>(db, 'notes', a.ids) }),
    apply: (a, { db }) => {
      requireRows(db, 'notes', a.ids);
      deleteRows(db, 'notes', 'note', a.ids);
      return { deleted: a.ids };
    },
  }),
];
