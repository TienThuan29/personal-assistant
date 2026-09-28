import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { toLocalDate } from '../shared/dates';
import { MIGRATIONS } from './migrations';

export type Db = DatabaseSync;
export type Params = Record<string, SQLInputValue>;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // fold(s): lowercase without Vietnamese accents, for accent-insensitive LIKE search.
  db.function('fold', { deterministic: true }, (s) =>
    typeof s === 'string' ? s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase() : s
  );
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
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

function migrate(db: Db): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (user_version > MIGRATIONS.length) throw new Error('Cơ sở dữ liệu được tạo bởi phiên bản mới hơn của ứng dụng');
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const BACKUP_RE = /^assistant-\d{4}-\d{2}-\d{2}\.db$/;

/** One snapshot per local day via VACUUM INTO (to a .tmp, then renamed, so a crash never leaves a partial match); keeps the newest `keep`. */
export function backupDb(db: Db, dir: string, now: Date, keep = 7): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `assistant-${toLocalDate(now)}.db`);
  if (!existsSync(file)) {
    const tmp = `${file}.tmp`;
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    renameSync(tmp, file);
  }
  const files = readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const f of files.slice(0, -keep)) rmSync(join(dir, f));
}
