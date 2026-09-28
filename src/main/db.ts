import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { toLocalDate } from '../shared/dates';
import { MIGRATIONS } from './migrations';

export type Db = DatabaseSync;
export type Params = Record<string, SQLInputValue>;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function migrate(db: Db): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const BACKUP_RE = /^assistant-\d{4}-\d{2}-\d{2}\.db$/;

/** One snapshot per local day via VACUUM INTO; keeps the newest `keep`. */
export function backupDb(db: Db, dir: string, now: Date, keep = 7): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `assistant-${toLocalDate(now)}.db`);
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const f of files.slice(0, -keep)) rmSync(join(dir, f));
}
