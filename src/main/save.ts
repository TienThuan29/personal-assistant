import { newAttachmentId, saveAttachment } from './attachments';
import { tx } from './db';
import { UserError } from './errors';
import { findTool, parseArgs, type ToolCtx } from './tools';
import { attachmentsCol, getRows, ids as idsSchema, type OwnerType, requireRows } from './tools/common';

/** Tools the manual forms save through (design C6): the record's image owner (null: takes no images) and table. */
export const SAVE_TOOLS: Record<string, { owner: OwnerType | null; table: string }> = {
  create_task: { owner: 'task', table: 'tasks' },
  update_tasks: { owner: 'task', table: 'tasks' },
  create_note: { owner: 'note', table: 'notes' },
  update_notes: { owner: 'note', table: 'notes' },
  create_expense: { owner: 'expense', table: 'expenses' },
  update_expenses: { owner: 'expense', table: 'expenses' },
  create_reminder: { owner: null, table: 'reminders' },
  update_reminders: { owner: null, table: 'reminders' },
};

/** Images per record, and per chat message. */
export const MAX_IMAGES = 10;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Creates or updates one record through its tool, adds `jpegs` to it and removes its attachments in `removeIds`, all in one
 * transaction. Everything is validated before the first write; files of a rolled-back save are swept at startup.
 */
export function saveRecord(
  ctx: ToolCtx & { attachmentsDir: string },
  name: unknown,
  args: unknown,
  jpegs: Uint8Array[],
  removeIds: unknown
): unknown {
  const target = typeof name === 'string' && Object.hasOwn(SAVE_TOOLS, name) ? SAVE_TOOLS[name] : undefined;
  const tool = target && findTool(name as string);
  if (!target || tool?.kind !== 'write') throw new UserError('notAllowed', { name: String(name) });
  const remove = removeIds ?? [];
  if (!Array.isArray(remove) || !remove.every((r) => typeof r === 'string')) throw new UserError('invalidValue');
  const { owner, table } = target;
  if (!owner && (jpegs.length || remove.length)) throw new UserError('invalidValue');
  if (!isObject(args)) throw new UserError('invalidValue');

  let run: () => number; // writes the record, returns its id
  if (tool.name.startsWith('update_')) {
    if (!Array.isArray(args.ids) || args.ids.length !== 1) throw new UserError('saveOneRecord');
    const ids = idsSchema.safeParse(args.ids);
    if (!ids.success) throw new UserError('invalidId');
    const [id] = ids.data;
    const { patch } = args;
    if (isObject(patch) && !Object.keys(patch).length) {
      run = () => (requireRows(ctx.db, table, [id]), id); // only the images changed: the tool would reject an empty patch
    } else {
      const parsed = parseArgs(tool, { ids: [id], patch });
      run = () => (tool.apply(parsed, ctx), id);
    }
  } else {
    // attachment_ids moves chat images; the form sends its images as bytes instead.
    const parsed = parseArgs(tool, { ...args, attachment_ids: undefined });
    run = () => (tool.apply(parsed, ctx) as { id: number }).id;
  }

  return tx(ctx.db, () => {
    const ownerId = run();
    if (owner) {
      for (const bytes of jpegs) saveAttachment(ctx.db, ctx.attachmentsDir, { id: newAttachmentId(), bytes, mime: 'image/jpeg', ownerType: owner, ownerId });
      const del = ctx.db.prepare('DELETE FROM attachments WHERE id = ? AND owner_type = ? AND owner_id = ?');
      for (const id of remove) del.run(id, owner, ownerId); // another record's id matches nothing
      const { n } = ctx.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE owner_type = ? AND owner_id = ?').get(owner, ownerId) as { n: number };
      if (n > MAX_IMAGES) throw new UserError('tooManyImages', { max: MAX_IMAGES }); // rolls the save back
    }
    // With attachment_ids, like the list tools.
    return owner
      ? ctx.db.prepare(`SELECT r.*, ${attachmentsCol(owner, 'r.id')} FROM ${table} r WHERE r.id = ?`).get(ownerId)
      : getRows(ctx.db, table, [ownerId])[0];
  });
}
