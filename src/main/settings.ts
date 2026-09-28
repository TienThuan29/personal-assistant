import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod/v4';
import type { LlmConfig } from '../shared/types';
import type { Db } from './db';

/** The key is sent to this endpoint, so only https (or http to a local gateway). Trailing '/' dropped: the SDK appends '/openai'. */
const endpoint = z
  .string()
  .trim()
  .pipe(z.url({ abort: true, error: 'errors:endpointUrl' })) // abort: otherwise the refine below still runs, and new URL() throws
  .refine((u) => {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname));
  }, 'errors:endpointHttps')
  .transform((u) => u.replace(/\/+$/, ''));

/** Not an LLM tool schema, so it never goes through toJSONSchema. */
export const llmConfigSchema = z.object({
  provider: z.enum(['azure', 'gateway']),
  endpoint,
  model: z.string().trim().min(1, 'errors:modelRequired'),
  apiVersion: z.string().trim().min(1, 'errors:apiVersionRequired'),
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
 * An undecryptable file (corrupt, or encrypted under another Windows user) reads as empty: the user re-enters the key.
 */
export function readSecrets(file: string, cipher: Cipher): Secrets {
  if (!existsSync(file)) return {};
  const data = readFileSync(file); // outside the try: a transient I/O error must throw, not wipe the other key on the next write
  try {
    const v: unknown = JSON.parse(cipher.decrypt(data));
    return typeof v === 'object' && v ? (v as Secrets) : {};
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
