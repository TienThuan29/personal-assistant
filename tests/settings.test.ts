import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cipher, getSetting, readSecrets, setSetting, writeSecret } from '../src/main/settings';
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
    writeSecret(file, cipher, 'azure', 'sk-new');
    expect(readSecrets(file, cipher)).toEqual({ azure: 'sk-new' });
  });
});
