import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod/v4';
import {
  DEFAULT_LLM,
  DEFAULT_UI,
  type LlmConfig,
  type LlmSettings,
  type Provider,
  PROVIDER_NAMES,
  type SavedConnection,
  type UiSettings,
} from '../shared/types';
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
 * anywhere), but only the active one must be complete: Azure needs a deployment and api-version; a gateway or LM Studio may pick the model itself.
 */
export const llmSettingsSchema = z
  .object({
    active: z.enum(['azure', 'gateway', 'lmstudio'], { error: 'errors:invalidValue' }),
    azure: z.object({ endpoint, model, apiVersion: z.string().trim() }),
    gateway: z.object({ endpoint, model }),
    // Absent from an older renderer's payload: fall back to the default local address.
    lmstudio: z.object({ endpoint, model }).default(DEFAULT_LLM.lmstudio),
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
    typeof p === 'string' && p in PROVIDER_NAMES && p !== active ? `${PROVIDER_NAMES[p as Provider]}: ${tr(message)}` : tr(message);
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
    active: s.active === 'azure' || s.active === 'lmstudio' ? s.active : 'gateway',
    azure: { ...DEFAULT_LLM.azure, ...s.azure },
    gateway: { ...DEFAULT_LLM.gateway, ...s.gateway },
    lmstudio: { ...DEFAULT_LLM.lmstudio, ...s.lmstudio },
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
  checkUpdates: z.boolean({ error: 'errors:invalidValue' }),
  theme: z.enum(['system', 'light', 'dark'], { error: 'errors:invalidValue' }),
  welcomed: z.boolean({ error: 'errors:invalidValue' }),
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
/** Keyed by provider (the key in use) or `conn:<id>` (a saved connection's key). */
type Secrets = Partial<Record<string, string>>;

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
export function writeSecret(file: string, cipher: Cipher, name: string, value: string | undefined): void {
  const secrets = { ...readSecrets(file, cipher) };
  if (value === undefined) delete secrets[name];
  else secrets[name] = value;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, cipher.encrypt(JSON.stringify(secrets)));
  renameSync(tmp, file);
}

// Saved connections (docs/connections-design.md): the list is a settings row, each key a `conn:<id>` secret.
export const MAX_CONNECTIONS = 20;
const connSecret = (id: string) => `conn:${id}`;
const sameConfig = (a: LlmConfig, b: LlmConfig) =>
  a.provider === b.provider && a.endpoint === b.endpoint && a.model === b.model && a.apiVersion === b.apiVersion;
const connName = (c: LlmConfig) => `${c.model || new URL(c.endpoint).host} · ${PROVIDER_NAMES[c.provider]}`;

/** The saved connections, most recently used first. A row that is not a list (hand-edited) reads as empty. */
export function getConnections(db: Db): SavedConnection[] {
  const raw = getSetting<unknown>(db, 'connections', []);
  const ok = (c: Partial<SavedConnection>): c is SavedConnection =>
    typeof c?.id === 'string' && typeof c.name === 'string' && typeof c.endpoint === 'string' && typeof c.model === 'string' && c.provider! in PROVIDER_NAMES;
  return (Array.isArray(raw) ? raw.filter(ok) : []).map((c) => ({ ...c, apiVersion: c.apiVersion ?? '', usedAt: Number(c.usedAt) || 0 })).sort((a, b) => b.usedAt - a.usedAt);
}

/**
 * Remembers `cfg` with its key (the provider's key in use), or refreshes the same connection: new key, new `usedAt`.
 * Nothing to remember without a key, except for LM Studio, which has none.
 */
export function rememberConnection(db: Db, file: string, cipher: Cipher, cfg: LlmConfig, now = Date.now()): void {
  const key = readSecrets(file, cipher)[cfg.provider];
  if (!cfg.endpoint || (cfg.provider !== 'lmstudio' && !key)) return;
  const list = getConnections(db);
  const known = list.find((c) => sameConfig(c, cfg));
  const id = known?.id ?? randomUUID();
  const rest = list.filter((c) => c !== known);
  const next = [{ ...cfg, id, name: known?.name ?? connName(cfg), usedAt: now }, ...rest];
  const dropped = next.splice(MAX_CONNECTIONS);
  setSetting(db, 'connections', next);
  if (key) writeSecret(file, cipher, connSecret(id), key);
  for (const c of dropped) writeSecret(file, cipher, connSecret(c.id), undefined);
}

/** First read after an upgrade: the provider settings already there become connections (the one in use, and any with a key). */
export function seedConnections(db: Db, file: string, cipher: Cipher): void {
  if (getSetting<unknown>(db, 'connections', null) !== null) return;
  setSetting(db, 'connections', []);
  const llm = getLlm(db);
  const secrets = readSecrets(file, cipher);
  const others = (Object.keys(PROVIDER_NAMES) as Provider[]).filter((p) => p !== llm.active && secrets[p]);
  const now = Date.now();
  [...others, llm.active].forEach((p, i) => rememberConnection(db, file, cipher, activeLlm({ ...llm, active: p }), now + i)); // the one in use last = newest
}

/** Makes connection `id` the one in use: its config and key replace its provider's slot, which becomes active. */
export function useConnection(db: Db, file: string, cipher: Cipher, id: unknown, now = Date.now()): void {
  const list = getConnections(db);
  const c = list.find((x) => x.id === id);
  if (!c) throw new UserError('connectionNotFound');
  const key = readSecrets(file, cipher)[connSecret(c.id)];
  if (c.provider !== 'lmstudio' && !key) throw new UserError('connectionKeyLost');
  const slot = c.provider === 'azure' ? { endpoint: c.endpoint, model: c.model, apiVersion: c.apiVersion } : { endpoint: c.endpoint, model: c.model };
  setSetting(db, 'llm', { ...getLlm(db), active: c.provider, [c.provider]: slot });
  if (key) writeSecret(file, cipher, c.provider, key);
  setSetting(db, 'connections', list.map((x) => (x === c ? { ...x, usedAt: now } : x)));
}

export function renameConnection(db: Db, id: unknown, name: unknown): void {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 60) throw new UserError('invalidValue');
  const list = getConnections(db);
  if (!list.some((c) => c.id === id)) throw new UserError('connectionNotFound');
  setSetting(db, 'connections', list.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
}

/** Forgets the connection and its key; the connection in use stays configured. */
export function removeConnection(db: Db, file: string, cipher: Cipher, id: unknown): void {
  const list = getConnections(db);
  if (!list.some((c) => c.id === id)) return;
  setSetting(db, 'connections', list.filter((c) => c.id !== id));
  writeSecret(file, cipher, connSecret(id as string), undefined);
}
