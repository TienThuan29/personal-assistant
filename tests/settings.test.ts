import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeLlm, type Cipher, getLlm, getSetting, getUi, llmSettingsSchema, parseLlmSettings, readSecrets, saveUi, setSetting, writeSecret } from '../src/main/settings';
import { DEFAULT_LLM, DEFAULT_UI } from '../src/shared/types';
import { tr } from '../src/main/tools/common';
import { tempDir, testDb } from './helpers';

// Stand-in for Electron safeStorage: reversible, but not plaintext.
const cipher: Cipher = {
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
};

describe('settings', () => {
  it('round-trips JSON values with a fallback', () => {
    const { db } = testDb();
    expect(getSetting(db, 'llm', { a: 1 })).toEqual({ a: 1 });
    setSetting(db, 'llm', { a: 2 });
    setSetting(db, 'llm', { a: 3 });
    expect(getSetting(db, 'llm', { a: 1 })).toEqual({ a: 3 });
  });

  it('keeps secrets per provider, encrypted, outside the DB', () => {
    const file = join(tempDir(), 'secrets.bin');
    expect(readSecrets(file, cipher)).toEqual({});
    writeSecret(file, cipher, 'azure', 'sk-secret');
    writeSecret(file, cipher, 'gateway', 'tok');
    expect(readSecrets(file, cipher)).toEqual({ azure: 'sk-secret', gateway: 'tok' });
    expect(readFileSync(file).toString('utf8')).not.toContain('sk-secret');
  });

  it('treats an unreadable secrets file as empty, and a new key replaces it', () => {
    const file = join(tempDir(), 'secrets.bin');
    writeFileSync(file, 'garbage');
    expect(readSecrets(file, cipher)).toEqual({});
    writeFileSync(file, cipher.encrypt('null'));
    expect(readSecrets(file, cipher)).toEqual({});
    writeSecret(file, cipher, 'azure', 'sk-new');
    expect(readSecrets(file, cipher)).toEqual({ azure: 'sk-new' });
  });

  const settings = (active: 'azure' | 'gateway', azure = {}, gateway = {}) => ({
    active,
    azure: { endpoint: '', model: '', apiVersion: '2024-10-21', ...azure },
    gateway: { endpoint: '', model: '', ...gateway },
  });
  const errors = (v: unknown) => llmSettingsSchema.safeParse(v).error?.issues.map((i) => tr(i.message));

  it('validates endpoints: https (or local http), trimmed, no trailing slash', () => {
    const base = { model: 'gpt-4o', apiVersion: '2024-10-21' };
    const ok = (endpoint: string, extra = {}) => llmSettingsSchema.safeParse(settings('azure', { ...base, endpoint, ...extra }));
    expect(ok(' https://r.openai.azure.com/ ', { extra: 1 }).data?.azure).toEqual({ ...base, endpoint: 'https://r.openai.azure.com' });
    expect(ok('http://localhost:4000/v1').data?.azure.endpoint).toBe('http://localhost:4000/v1');
    expect(ok('http://example.com').success).toBe(false);
    expect(ok('javascript:alert(1)').success).toBe(false);
    for (const bad of ['', '   ', 'not a url', 'https://']) expect(ok(bad).success).toBe(false); // no throw either
    expect(ok('https://r.openai.azure.com', { model: '   ' }).success).toBe(false);
  });

  it('only the active provider must be complete; the other may be empty but not invalid', () => {
    const gw = settings('gateway', {}, { endpoint: 'https://gw.example/v1', model: ' ' });
    expect(llmSettingsSchema.safeParse(gw).data).toEqual({ ...gw, gateway: { endpoint: 'https://gw.example/v1', model: '' } });
    expect(errors({ ...gw, active: 'azure' })).toEqual(['Endpoint chưa đúng dạng URL (vd https://…)', 'Chưa nhập model/deployment']);
    expect(errors({ ...gw, azure: { endpoint: 'http://example.com', model: '', apiVersion: '' } })).toEqual(['Endpoint phải dùng https']);
    expect(errors(settings('azure', { endpoint: 'https://r', model: 'm', apiVersion: ' ' }))).toEqual(['Chưa nhập API version']);
    expect(errors({ ...gw, active: 'other' })).toEqual(['Giá trị không hợp lệ']);
    expect(errors(null)?.length).toBeGreaterThan(0);
  });

  it('names the provider that is not on screen in its errors', () => {
    const gw = settings('gateway', { endpoint: 'http://example.com', model: 'sk-abc' }, { endpoint: 'not a url' });
    expect(() => parseLlmSettings(gw)).toThrow(
      /^Azure AI Foundry: Endpoint phải dùng https; Azure AI Foundry: Ô Model trông giống[^;]*; Endpoint chưa đúng dạng URL \(vd https:\/\/…\)$/
    );
    expect(() => parseLlmSettings({ ...gw, active: 'azure', gateway: { endpoint: 'http://x.com', model: '' } })).toThrow(
      /^Endpoint phải dùng https; Ô Model[^;]*; LLM gateway: Endpoint phải dùng https$/
    );
    expect(parseLlmSettings(settings('gateway', {}, { endpoint: 'https://gw/v1' })).gateway.endpoint).toBe('https://gw/v1');
    expect(() => parseLlmSettings(undefined)).toThrow();
  });

  it('refuses a key/token pasted into the plain-text Model field of either provider', () => {
    const gw = (model: string) => settings('gateway', {}, { endpoint: 'https://gw.example/v1', model });
    for (const m of ['sk-gw-0740c47e9f5a', 'sk_live_abc', 'Bearer abc']) {
      expect(errors(gw(m))?.[0]).toMatch(/Access token/);
      expect(errors({ ...gw(''), azure: { endpoint: '', model: m, apiVersion: '' } })?.[0]).toMatch(/Access token/);
    }
    for (const m of ['gpt-4o', 'anthropic.claude-3-5-sonnet-20240620-v1:0', 'gemini-1.5-pro', '']) expect(errors(gw(m))).toBeUndefined();
  });

  it('migrates the old flat llm row to per-provider settings on read (G3)', () => {
    const { db } = testDb();
    expect(getLlm(db)).toEqual(DEFAULT_LLM);
    setSetting(db, 'llm', { provider: 'gateway', endpoint: 'https://gw.example/v1', model: 'gpt-5.1-02', apiVersion: '2024-10-21' });
    expect(getLlm(db)).toEqual({ ...DEFAULT_LLM, active: 'gateway', gateway: { endpoint: 'https://gw.example/v1', model: 'gpt-5.1-02' } });
    expect(activeLlm(getLlm(db))).toEqual({ provider: 'gateway', endpoint: 'https://gw.example/v1', model: 'gpt-5.1-02', apiVersion: '' });
    setSetting(db, 'llm', { provider: 'azure', endpoint: 'https://r', model: 'gpt-4o', apiVersion: '2025-01-01' });
    expect(getLlm(db)).toEqual({ ...DEFAULT_LLM, active: 'azure', azure: { endpoint: 'https://r', model: 'gpt-4o', apiVersion: '2025-01-01' } });
    // The new shape round-trips; a partial row fills in the defaults and a junk row reads as them.
    const saved = { active: 'azure', azure: { endpoint: 'https://r', model: 'd', apiVersion: 'v' }, gateway: { endpoint: 'https://g', model: '' } };
    setSetting(db, 'llm', saved);
    expect(getLlm(db)).toEqual(saved);
    setSetting(db, 'llm', { gateway: { endpoint: 'https://g' } });
    expect(getLlm(db)).toEqual({ ...DEFAULT_LLM, gateway: { endpoint: 'https://g', model: '' } });
    setSetting(db, 'llm', 'junk');
    expect(getLlm(db)).toEqual(DEFAULT_LLM);
  });

  it('merges UI settings over the defaults, normalizing the currency', () => {
    const { db } = testDb();
    expect(getUi(db)).toEqual(DEFAULT_UI);
    expect(saveUi(db, { language: 'en' })).toEqual({ ...DEFAULT_UI, language: 'en' });
    expect(saveUi(db, { defaultCurrency: ' usd ', extra: 1 })).toEqual({ language: 'en', moneyStyle: 'vi', defaultCurrency: 'USD', accent: '#ab502d' });
    expect(getUi(db)).toEqual({ language: 'en', moneyStyle: 'vi', defaultCurrency: 'USD', accent: '#ab502d' });
  });

  it('ignores a __proto__ key in the UI patch', () => {
    const { db } = testDb();
    const saved = saveUi(db, JSON.parse('{"__proto__": {"polluted": 1}, "language": "en"}'));
    expect(saved).toEqual({ ...DEFAULT_UI, language: 'en' });
    expect(Object.keys(saved)).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(getSetting<object>(db, 'ui', {})).not.toHaveProperty('polluted');
    expect(JSON.stringify(getSetting(db, 'ui', {}))).not.toContain('__proto__');
  });

  it('reads an invalid stored row as the defaults', () => {
    const { db } = testDb();
    setSetting(db, 'ui', { language: 'fr', defaultCurrency: 'USD' });
    expect(getUi(db)).toEqual(DEFAULT_UI);
    setSetting(db, 'ui', 'en');
    expect(getUi(db)).toEqual(DEFAULT_UI);
  });

  it('rejects invalid UI settings and keeps the saved ones', () => {
    const { db } = testDb();
    expect(() => saveUi(db, { defaultCurrency: 'dollars' })).toThrow('Mã tiền tệ ISO 4217');
    expect(() => saveUi(db, { language: 'fr' })).toThrow('Giá trị không hợp lệ');
    expect(() => saveUi(db, { moneyStyle: 'us' })).toThrow('Giá trị không hợp lệ');
    for (const bad of [null, 'en', ['en']]) expect(() => saveUi(db, bad)).toThrow('Giá trị không hợp lệ');
    expect(getUi(db)).toEqual(DEFAULT_UI);
  });

  it('saves the accent as lowercase #rrggbb and rejects anything else', () => {
    const { db } = testDb();
    expect(saveUi(db, { accent: '#3366AA' }).accent).toBe('#3366aa');
    for (const accent of ['red', '#12345', '#1234567', 123]) expect(() => saveUi(db, { accent })).toThrow('Giá trị không hợp lệ');
    expect(getUi(db).accent).toBe('#3366aa');
  });

  it('reads a stored row without accent with the default accent', () => {
    const { db } = testDb();
    setSetting(db, 'ui', { language: 'en', moneyStyle: 'intl', defaultCurrency: 'USD' });
    expect(getUi(db)).toEqual({ language: 'en', moneyStyle: 'intl', defaultCurrency: 'USD', accent: '#ab502d' });
  });
});
