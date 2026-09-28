import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';

/** Short id; the model sees it as the label [ảnh #id]. Lowercase hex, so it is a valid att:// host. */
export const newAttachmentId = (): string => randomUUID().replace(/-/g, '').slice(0, 8);

export function saveAttachment(
  db: Db,
  dir: string,
  a: { id: string; bytes: Uint8Array; mime: string; ownerType: 'message' | 'task' | 'note' | 'expense'; ownerId: number }
): void {
  mkdirSync(dir, { recursive: true });
  const fileName = `${a.id}.${a.mime === 'image/png' ? 'png' : 'jpg'}`;
  writeFileSync(join(dir, fileName), a.bytes, { flag: 'wx' }); // an id collision throws instead of overwriting
  db.prepare('INSERT INTO attachments (id, owner_type, owner_id, file_name, mime) VALUES (?, ?, ?, ?, ?)').run(
    a.id,
    a.ownerType,
    a.ownerId,
    fileName,
    a.mime
  );
}

export function attachmentFile(db: Db, dir: string, id: string): { path: string; mime: string } | undefined {
  const row = db.prepare('SELECT file_name, mime FROM attachments WHERE id = ?').get(id) as
    | { file_name: string; mime: string }
    | undefined;
  if (!row) return undefined;
  const path = join(dir, row.file_name);
  return existsSync(path) ? { path, mime: row.mime } : undefined;
}

export function dataUrl(db: Db, dir: string, id: string): string | undefined {
  const f = attachmentFile(db, dir, id);
  return f && `data:${f.mime};base64,${readFileSync(f.path).toString('base64')}`;
}

/** Deletes files no attachment row points at (their owner was deleted). */
export function cleanupOrphans(db: Db, dir: string): number {
  if (!existsSync(dir)) return 0;
  const known = new Set((db.prepare('SELECT file_name FROM attachments').all() as { file_name: string }[]).map((r) => r.file_name));
  let deleted = 0;
  for (const f of readdirSync(dir)) {
    if (known.has(f)) continue;
    try {
      rmSync(join(dir, f), { force: true, recursive: true });
      deleted++;
    } catch {
      // Locked (antivirus, an open viewer): skip it; the next startup retries.
    }
  }
  return deleted;
}
