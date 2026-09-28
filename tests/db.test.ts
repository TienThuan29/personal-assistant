import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDb, openDb, tx } from '../src/main/db';
import { MIGRATIONS } from '../src/main/migrations';
import { NOW, tempDir, testDb } from './helpers';

describe('db', () => {
  it('migrates to the latest version and is idempotent', () => {
    const { db, path } = testDb();
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    db.close();
    expect(() => openDb(path)).not.toThrow();
  });

  it('refuses a DB from a newer app version', () => {
    const { db, path } = testDb();
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    expect(() => openDb(path)).toThrow('phiên bản mới hơn');
  });

  it('enables foreign keys', () => {
    const { db } = testDb();
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('tx rolls back on error', () => {
    const { db } = testDb();
    expect(() =>
      tx(db, () => {
        db.prepare("INSERT INTO tasks (title) VALUES ('a')").run();
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(0);
  });

  it('tx rethrows the original error when no transaction is left to roll back', () => {
    const { db } = testDb();
    expect(() =>
      tx(db, () => {
        db.exec('COMMIT');
        throw new Error('boom');
      })
    ).toThrow('boom');
  });

  it('backs up once per day and keeps the newest 7', () => {
    const { db } = testDb();
    const dir = join(tempDir(), 'backups');
    backupDb(db, dir, NOW);
    backupDb(db, dir, NOW); // same day: no second file, no error
    for (let d = 1; d <= 8; d++) writeFileSync(join(dir, `assistant-2026-08-0${d}.db`), '');
    backupDb(db, dir, NOW);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(7);
    expect(files.at(-1)).toBe('assistant-2026-09-28.db');
    expect(existsSync(join(dir, 'assistant-2026-08-01.db'))).toBe(false);
    const snap = new DatabaseSync(join(dir, 'assistant-2026-09-28.db'), { readOnly: true });
    expect((snap.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    snap.close();
  });
});
