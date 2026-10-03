import { join } from 'node:path';
import { createCipher, type SafeStorageLike } from '../src/main/cipher';
import { tempDir } from './helpers';

const fakeOs = (available: boolean): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
});

describe('createCipher', () => {
  it('uses the OS keystore when available', () => {
    const c = createCipher(fakeOs(true), join(tempDir(), 'k'));
    const enc = c.encrypt('sk-secret');
    expect(enc[0]).toBe(0x01);
    expect(c.decrypt(enc)).toBe('sk-secret');
  });

  it('falls back to an AES-GCM file key when the keystore is unavailable (macOS ad-hoc signed)', () => {
    const c = createCipher(fakeOs(false), join(tempDir(), 'k'));
    const enc = c.encrypt('sk-secret');
    expect(enc[0]).toBe(0x02);
    expect(enc.toString('utf8')).not.toContain('sk-secret');
    expect(c.decrypt(enc)).toBe('sk-secret');
  });

  it('falls back when the keystore throws at encrypt time', () => {
    const os = { ...fakeOs(true), encryptString: () => { throw new Error('keychain denied'); } };
    const c = createCipher(os, join(tempDir(), 'k'));
    expect(c.decrypt(c.encrypt('tok'))).toBe('tok');
  });

  it('reuses the key file across instances', () => {
    const keyFile = join(tempDir(), 'k');
    const enc = createCipher(fakeOs(false), keyFile).encrypt('tok');
    expect(createCipher(fakeOs(false), keyFile).decrypt(enc)).toBe('tok');
  });

  it('still reads legacy untagged safeStorage data', () => {
    const os = fakeOs(true);
    expect(createCipher(os, join(tempDir(), 'k')).decrypt(os.encryptString('old'))).toBe('old');
  });
});
