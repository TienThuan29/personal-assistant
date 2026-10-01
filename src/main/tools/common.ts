import { z } from 'zod/v4';
import { localDayRange, parseLocalDate, toLocalDate } from '../../shared/dates';
import type { UiSettings } from '../../shared/types';
import type { Db, Params } from '../db';
import { UserError } from '../errors';

export { errMsg, type ErrorKey, te, tr, UserError } from '../errors';

export type ToolCtx = { db: Db; ro: Db; now: () => Date; settings: () => UiSettings };

type Base<S extends z.ZodType> = { name: string; description: string; schema: S };
export type ReadTool<S extends z.ZodType = z.ZodType> = Base<S> & {
  kind: 'read';
  run: (args: z.output<S>, ctx: ToolCtx) => unknown;
};
export type WriteTool<S extends z.ZodType = z.ZodType> = Base<S> & {
  kind: 'write';
  /** Current rows the action will touch, for the confirm card (before → after). */
  preview?: (args: z.output<S>, ctx: ToolCtx) => unknown;
  apply: (args: z.output<S>, ctx: ToolCtx) => unknown;
};
/** Asks the user: parked like a write, but answered with their replies instead of applied (see agent.ts answerAction). */
export type AskTool<S extends z.ZodType = z.ZodType> = Base<S> & { kind: 'ask' };
// oxlint-disable-next-line no-explicit-any -- heterogeneous registry; each tool is typed at its definition
export type Tool = ReadTool<any> | WriteTool<any> | AskTool<any>;

export const readTool = <S extends z.ZodType>(t: Omit<ReadTool<S>, 'kind'>): Tool => ({ ...t, kind: 'read' });
export const writeTool = <S extends z.ZodType>(t: Omit<WriteTool<S>, 'kind'>): Tool => ({ ...t, kind: 'write' });
export const askTool = <S extends z.ZodType>(t: Omit<AskTool<S>, 'kind'>): Tool => ({ ...t, kind: 'ask' });

// ---- shared schemas ----
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'errors:dateFormat')
  .refine((s) => toLocalDate(parseLocalDate(s)) === s, 'errors:dateInvalid'); // rejects e.g. 2026-02-30
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'errors:timeFormat');
export const instant = z
  .union([date, z.iso.datetime({ local: true, offset: true })], {
    error: 'errors:instantFormat',
  })
  .describe('Ngày YYYY-MM-DD hoặc thời điểm ISO 8601 theo giờ máy, vd 2026-09-29T09:00');
export const ids = z.array(z.number().int().positive()).min(1).describe('ID lấy từ kết quả tool');
export const attachmentIds = z
  .array(z.string())
  .optional()
  .describe('ID ảnh từ tin nhắn của người dùng (nhãn [ảnh #id]) để đính kèm vào bản ghi');

/** Instant → UTC ISO. A bare date means local midnight ('start') or the next local midnight ('end'). */
export function toInstant(s: string, edge: 'start' | 'end' = 'start'): string {
  if (date.safeParse(s).success) return localDayRange(s)[edge];
  return new Date(s).toISOString(); // 'YYYY-MM-DDTHH:MM' without offset parses as local time
}

// ---- SQL helpers ----
export type OwnerType = 'task' | 'note' | 'expense';
const placeholders = (n: number): string => Array(n).fill('?').join(', ');

/** Selects the comma-separated attachment ids of each row. */
export const attachmentsCol = (owner: OwnerType, idExpr: string): string =>
  `(SELECT group_concat(a.id) FROM attachments a WHERE a.owner_type = '${owner}' AND a.owner_id = ${idExpr}) AS attachment_ids`;

/** WHERE clause from optional conditions; a condition is skipped when its value is undefined. */
export function where(conds: [sql: string, key: string, value: Exclude<Params[string], null> | undefined][]): {
  sql: string;
  params: Params;
} {
  const parts: string[] = [];
  const params: Params = {};
  for (const [sql, key, value] of conds) {
    if (value === undefined) continue;
    parts.push(sql);
    params[key] = value;
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export function getRows<T>(db: Db, table: string, idList: number[]): T[] {
  return db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders(idList.length)})`).all(...idList) as unknown as T[];
}

/** Like getRows, but throws unless every id exists, so a confirm card never touches fewer rows than it showed. */
export function requireRows<T>(db: Db, table: string, idList: number[]): T[] {
  const rows = getRows<T & { id: number }>(db, table, idList);
  const found = new Set(rows.map((r) => r.id));
  const missing = [...new Set(idList)].filter((id) => !found.has(id));
  if (missing.length) throw new UserError('notFound', { table, ids: missing.join(', #') });
  return rows;
}

/** UPDATE by id. Column names come from a zod-parsed patch, so unknown keys were already stripped; undefined values are skipped. */
export function updateRows(db: Db, table: string, idList: number[], patch: Record<string, unknown>, extra: Params = {}): void {
  const values = { ...(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Params), ...extra };
  if (!Object.keys(values).length) throw new UserError('emptyPatch');
  const set = Object.keys(values).map((k) => `${k} = :${k}`).join(', ');
  const stmt = db.prepare(`UPDATE ${table} SET ${set} WHERE id = :id`);
  for (const id of idList) stmt.run({ ...values, id });
}

/**
 * Reuses an existing spelling of a category in `table` ('an uong' → 'Ăn uống') so one category never splits by case or accents.
 * `exclude` skips the rows being updated, so renaming all of a category's rows still takes effect.
 */
export const canonCategory = (db: Db, table: 'tasks' | 'expenses', c: string, exclude: number[] = []): string =>
  (
    db
      .prepare(`SELECT category FROM ${table} WHERE fold(category) = fold(?) AND id NOT IN (${placeholders(exclude.length)}) LIMIT 1`)
      .get(c, ...exclude) as { category: string } | undefined
  )?.category ?? c;

/** Deletes rows and (for owners of images) their attachment rows; files are swept at startup. */
export function deleteRows(db: Db, table: string, owner: OwnerType | null, idList: number[]): void {
  if (owner) {
    db.prepare(`DELETE FROM attachments WHERE owner_type = ? AND owner_id IN (${placeholders(idList.length)})`).run(owner, ...idList);
  }
  db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders(idList.length)})`).run(...idList);
}

/** Moves images from the chat message to the new record (one image belongs to one record). */
export function attachTo(db: Db, owner: OwnerType, ownerId: number, attachmentIdList: string[] = []): void {
  const stmt = db.prepare("UPDATE attachments SET owner_type = ?, owner_id = ? WHERE id = ? AND owner_type = 'message'");
  for (const id of attachmentIdList) stmt.run(owner, ownerId, id);
}
