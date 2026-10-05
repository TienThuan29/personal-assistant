import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cleanupOrphans } from './attachments';
import { backupDb, type Db, openDb } from './db';
import { setLanguage } from './i18n';
import { getUi } from './settings';
import { pruneEmptyConversations } from './store';

/** Opens the data dir for both the desktop app and the server: DB, read-only handle, backup, startup cleanup. */
export function openData(dataDir: string, now: Date): { db: Db; ro: Db; dbPath: string; attachmentsDir: string } {
  const dbPath = join(dataDir, 'assistant.db');
  const attachmentsDir = join(dataDir, 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });

  const db = openDb(dbPath);
  setLanguage(getUi(db).language);
  const ro = new DatabaseSync(dbPath, { readOnly: true });
  try {
    backupDb(db, join(dataDir, 'backups'), now);
  } catch (e) {
    console.error('Backup failed, continuing without it', e); // a backup must never block startup
  }
  pruneEmptyConversations(db);
  cleanupOrphans(db, attachmentsDir);
  return { db, ro, dbPath, attachmentsDir };
}
