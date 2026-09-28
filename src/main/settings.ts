import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod/v4';
import type { LlmConfig } from '../shared/types';
import type { Db } from './db';

export const llmConfigSchema = z.object({
  provider: z.enum(['azure', 'gateway']),
  endpoint: z.url(),
  model: z.string().min(1),
  apiVersion: z.string().min(1),
});

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  );
}

/** Electron safeStorage in the app; a fake in tests. */
export type Cipher = { encrypt: (plain: string) => Buffer; decrypt: (data: Buffer) => string };
type Secrets = Partial<Record<LlmConfig['provider'], string>>;

/**
 * Secrets live in their own file, never in the DB, so query_readonly_sql can't leak them (design D14).
 * An unreadable file (corrupt, or encrypted under another Windows user) reads as empty: the user re-enters the key.
 */
export function readSecrets(file: string, cipher: Cipher): Secrets {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(cipher.decrypt(readFileSync(file))) as Secrets;
  } catch {
    return {};
  }
}

/** Writes a .tmp then renames it, so a crash mid-write never leaves a half-written file. */
export function writeSecret(file: string, cipher: Cipher, provider: LlmConfig['provider'], value: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, cipher.encrypt(JSON.stringify({ ...readSecrets(file, cipher), [provider]: value })));
  renameSync(tmp, file);
}
