import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentFile, cleanupOrphans, dataUrl, newAttachmentId, saveAttachment } from '../src/main/attachments';
import { attachTo } from '../src/main/tools/common';
import { testDb } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('attachments', () => {
  it('saves the file and a row, and reads back a data URL', () => {
    const { db, dir } = testDb();
    const id = newAttachmentId();
    saveAttachment(db, join(dir, 'att'), { id, bytes: JPEG, mime: 'image/jpeg', ownerType: 'message', ownerId: 1 });
    expect(existsSync(attachmentFile(db, join(dir, 'att'), id)!.path)).toBe(true);
    expect(dataUrl(db, join(dir, 'att'), id)).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
  });

  it('attachTo moves only message-owned images', () => {
    const { db, dir } = testDb();
    const id = newAttachmentId();
    saveAttachment(db, dir, { id, bytes: JPEG, mime: 'image/jpeg', ownerType: 'message', ownerId: 1 });
    attachTo(db, 'task', 7, [id]);
    attachTo(db, 'note', 8, [id]); // already moved: no-op
    expect(db.prepare('SELECT owner_type, owner_id FROM attachments WHERE id = ?').get(id)).toEqual({ owner_type: 'task', owner_id: 7 });
  });

  it('cleanupOrphans deletes files without a row', () => {
    const { db, dir } = testDb();
    const att = join(dir, 'att');
    const kept = newAttachmentId();
    saveAttachment(db, att, { id: kept, bytes: JPEG, mime: 'image/jpeg', ownerType: 'message', ownerId: 1 });
    writeFileSync(join(att, 'orphan.jpg'), JPEG);
    expect(cleanupOrphans(db, att)).toBe(1);
    expect(existsSync(join(att, 'orphan.jpg'))).toBe(false);
    expect(attachmentFile(db, att, kept)).toBeDefined();
  });
});
