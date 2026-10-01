import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { DEFAULT_LLM, DEFAULT_UI, type LlmConfig, type LlmSettings, type Provider, PROVIDER_NAMES, type UiSettings } from '../shared/types';
import type { Db } from './db';
import { tr, UserError } from './errors';

/**
 * The key is sent to this endpoint, so only https (or http to a local gateway). Trailing '/' dropped: the SDK appends '/openai'.
 * Empty is allowed here (a provider not set up yet); the active provider's endpoint is required below.
 */
const endpoint = z
  .string()
  .trim()
  .refine((u) => !u || (URL.canParse(u) && !!new URL(u).hostname), { message: 'errors:endpointUrl', abort: true })
  .refine((u) => {
    if (!u) return true;
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname));
  }, 'errors:endpointHttps')
  .transform((u) => u.replace(/\/+$/, ''));

// Model is stored in plain text; refuse something that looks like a pasted key/token (it belongs in the key field).
const model = z
  .string()
  .trim()
  .refine((m) => !/^(sk|pk|gw|key)[-_]|^bearer\s/i.test(m), 'errors:modelLooksLikeKey');

/**
 * Not an LLM tool schema, so it never goes through toJSONSchema. Both providers are validated (a key-looking model is refused
 * anywhere), but only the active one must be complete: Azure needs a deployment and api-version; a gateway may pick the model itself.
 */
export const llmSettingsSchema = z
  .object({
    active: z.enum(['azure', 'gateway'], { error: 'errors:invalidValue' }),
    azure: z.object({ endpoint, model, apiVersion: z.string().trim() }),
    gateway: z.object({ endpoint, model }),
  })
  // `when`: also check when another field is invalid, so every error shows at once.
  .refine((s) => typeof s?.[s?.active]?.endpoint !== 'string' || !!s[s.active].endpoint.trim(), {
    path: [],
    message: 'errors:endpointUrl',
    when: () => true,
  })
  .refine((s) => s?.active !== 'azure' || !!s.azure?.model?.trim(), { path: ['azure', 'model'], message: 'errors:modelRequired', when: () => true })
  .refine((s) => s?.active !== 'azure' || !!s.azure?.apiVersion?.trim(), {
    path: ['azure', 'apiVersion'],
    message: 'errors:apiVersionRequired',
    when: () => true,
  });

/**
 * Validates LLM settings from the renderer, throwing the translated issues. An issue in the provider that is not on screen
 * (not `active`) is prefixed with its name, e.g. "Azure AI Foundry: Endpoint phải dùng https".
 */
export function parseLlmSettings(v: unknown): LlmSettings {
  const r = llmSettingsSchema.safeParse(v);
  if (r.success) return r.data;
  const active = (v as { active?: unknown } | null)?.active;
  const text = ({ path: [p], message }: (typeof r.error.issues)[number]) =>
    (p === 'azure' || p === 'gateway') && p !== active ? `${PROVIDER_NAMES[p]}: ${tr(message)}` : tr(message);
  throw new Error([...new Set(r.error.issues.map(text))].join('; '));
}

/**
 * The stored LLM settings over the defaults. A row in the old flat shape `{provider, endpoint, model, apiVersion}` reads as
 * that provider's config and the active one (design G3); the next save writes the new shape.
 */
export function getLlm(db: Db): LlmSettings {
  const raw = getSetting<unknown>(db, 'llm', null);
  const s = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown> & Partial<LlmSettings>;
  if (typeof s.provider === 'string') {
    const active = s.provider === 'azure' ? 'azure' : 'gateway';
    const { endpoint = '', model = '', apiVersion = DEFAULT_LLM.azure.apiVersion } = s as Record<string, string>;
    return { ...DEFAULT_LLM, active, [active]: active === 'azure' ? { endpoint, model, apiVersion } : { endpoint, model } };
  }
  return {
    active: s.active === 'azure' ? 'azure' : 'gateway',
    azure: { ...DEFAULT_LLM.azure, ...s.azure },
    gateway: { ...DEFAULT_LLM.gateway, ...s.gateway },
  };
}

/** The active provider's connection, for createLlm. */
export const activeLlm = (s: LlmSettings): LlmConfig => ({ apiVersion: '', ...s[s.active], provider: s.active });

export const uiSettingsSchema = z.object({
  language: z.enum(['vi', 'en'], { error: 'errors:invalidValue' }),
  moneyStyle: z.enum(['vi', 'intl'], { error: 'errors:invalidValue' }),
  defaultCurrency: z
    .string({ error: 'errors:currencyFormat' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'errors:currencyFormat'),
  accent: z
    .string({ error: 'errors:invalidValue' })
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, 'errors:invalidValue'),
});

/** Stored values over the defaults; a row that fails validation (hand-edited, corrupt) reads as the defaults. */
export function getUi(db: Db): UiSettings {
  const stored = getSetting<unknown>(db, 'ui', {});
  const parsed = uiSettingsSchema.safeParse({ ...DEFAULT_UI, ...(typeof stored === 'object' ? stored : {}) });
  return parsed.success ? parsed.data : DEFAULT_UI;
}

/** Merges a patch from the renderer over the current settings, validates and saves. Throws the translated zod messages. */
export function saveUi(db: Db, patch: unknown): UiSettings {
  if (typeof patch !== 'object' || !patch || Array.isArray(patch)) throw new UserError('invalidValue');
  const parsed = uiSettingsSchema.safeParse({ ...getUi(db), ...patch });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => tr(i.message)).join('; '));
  setSetting(db, 'ui', parsed.data);
  return parsed.data;
}

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
type Secrets = Partial<Record<Provider, string>>;

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
export function writeSecret(file: string, cipher: Cipher, provider: Provider, value: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, cipher.encrypt(JSON.stringify({ ...readSecrets(file, cipher), [provider]: value })));
  renameSync(tmp, file);
}
