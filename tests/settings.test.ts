import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cipher, getSetting, getUi, llmConfigSchema, readSecrets, saveUi, setSetting, writeSecret } from '../src/main/settings';
import { DEFAULT_UI } from '../src/shared/types';
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

  it('validates the LLM config: https (or local http), trimmed, no trailing slash', () => {
    const base = { provider: 'azure', model: 'gpt-4o', apiVersion: '2024-10-21' };
    const ok = (endpoint: string, extra = {}) => llmConfigSchema.safeParse({ ...base, endpoint, ...extra });
    expect(ok(' https://r.openai.azure.com/ ', { extra: 1 }).data).toEqual({ ...base, endpoint: 'https://r.openai.azure.com' });
    expect(ok('http://localhost:4000/v1').data?.endpoint).toBe('http://localhost:4000/v1');
    expect(ok('http://example.com').success).toBe(false);
    expect(ok('javascript:alert(1)').success).toBe(false);
    for (const bad of ['', '   ', 'not a url', 'https://']) expect(ok(bad).success).toBe(false); // no throw either
    expect(ok('https://r.openai.azure.com', { model: '   ' }).success).toBe(false);
  });

  it('model and apiVersion are optional for a gateway, required for Azure', () => {
    const gw = { provider: 'gateway', endpoint: 'https://gw.example/v1', model: ' ', apiVersion: '' };
    expect(llmConfigSchema.safeParse(gw).data).toEqual({ ...gw, model: '' });
    const r = llmConfigSchema.safeParse({ ...gw, provider: 'azure' });
    expect(r.error?.issues.map((i) => tr(i.message))).toEqual(['Chưa nhập model/deployment', 'Chưa nhập API version']);
  });

  it('refuses a key/token pasted into the plain-text Model field', () => {
    const gw = { provider: 'gateway', endpoint: 'https://gw.example/v1', apiVersion: '' };
    for (const m of ['sk-gw-0740c47e9f5a', 'sk_live_abc', 'Bearer abc'])
      expect(llmConfigSchema.safeParse({ ...gw, model: m }).error?.issues.map((i) => tr(i.message))[0]).toMatch(/Access token/);
    for (const m of ['gpt-4o', 'anthropic.claude-3-5-sonnet-20240620-v1:0', 'gemini-1.5-pro', ''])
      expect(llmConfigSchema.safeParse({ ...gw, model: m }).success).toBe(true);
  });

  it('explains invalid fields in Vietnamese', () => {
    const r = llmConfigSchema.safeParse({ provider: 'azure', endpoint: '', model: ' ', apiVersion: '2024-10-21' });
    expect(r.error?.issues.map((i) => tr(i.message))).toEqual(['Endpoint chưa đúng dạng URL (vd https://…)', 'Chưa nhập model/deployment']);
  });

  it('merges UI settings over the defaults, normalizing the currency', () => {
    const { db } = testDb();
    expect(getUi(db)).toEqual(DEFAULT_UI);
    expect(saveUi(db, { language: 'en' })).toEqual({ ...DEFAULT_UI, language: 'en' });
    expect(saveUi(db, { defaultCurrency: ' usd ', extra: 1 })).toEqual({ language: 'en', moneyStyle: 'vi', defaultCurrency: 'USD' });
    expect(getUi(db)).toEqual({ language: 'en', moneyStyle: 'vi', defaultCurrency: 'USD' });
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
});
