import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/main/db';

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'pa-test-'));

/** A file-backed DB (so a read-only second connection can see it) plus that read-only connection. */
export function testDb() {
  const dir = tempDir();
  const path = join(dir, 'test.db');
  const db = openDb(path);
  const ro = new DatabaseSync(path, { readOnly: true });
  return { dir, path, db, ro };
}

/** 2026-09-28 09:00 local, a Monday. */
export const NOW = new Date(2026, 8, 28, 9, 0);
