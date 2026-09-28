import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cipher, getSetting, llmConfigSchema, readSecrets, setSetting, writeSecret } from '../src/main/settings';
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

  it('explains invalid fields in Vietnamese', () => {
    const r = llmConfigSchema.safeParse({ provider: 'azure', endpoint: '', model: ' ', apiVersion: '2024-10-21' });
    expect(r.error?.issues.map((i) => i.message)).toEqual(['Endpoint chưa đúng dạng URL (vd https://…)', 'Chưa nhập model/deployment']);
  });
});
