import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Cipher } from './settings';

/** The slice of Electron's safeStorage we use; a fake in tests. */
export type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (data: Buffer) => string;
};

// One-byte tag in front of the ciphertext says which scheme wrote it. Data without a tag predates this module: raw safeStorage output.
const TAG_OS = 0x01; // OS keystore (Keychain / DPAPI / libsecret) via safeStorage
const TAG_FILE = 0x02; // AES-256-GCM, key in a 0600 file next to the secrets

function fileKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    const k = readFileSync(keyFile);
    if (k.length === 32) return k;
  }
  const k = randomBytes(32);
  writeFileSync(keyFile, k, { mode: 0o600 });
  return k;
}

/**
 * Prefers the OS keystore. On macOS an ad-hoc signed app (no Developer ID) often cannot use the Keychain, so safeStorage reports
 * unavailable; rather than refuse to save the key, fall back to an AES-GCM key kept in a user-only file. That is weaker than the
 * Keychain (anything running as this user can read both files) but still keeps the secret out of the DB and out of plain text.
 */
export function createCipher(safeStorage: SafeStorageLike, keyFile: string): Cipher {
  return {
    encrypt: (plain) => {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          return Buffer.concat([Buffer.from([TAG_OS]), safeStorage.encryptString(plain)]);
        } catch {
          // Keychain denied at call time: fall through to the file key.
        }
      }
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', fileKey(keyFile), iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([TAG_FILE]), iv, c.getAuthTag(), body]);
    },
    decrypt: (data) => {
      if (data[0] === TAG_FILE) {
        const d = createDecipheriv('aes-256-gcm', fileKey(keyFile), data.subarray(1, 13));
        d.setAuthTag(data.subarray(13, 29));
        return Buffer.concat([d.update(data.subarray(29)), d.final()]).toString('utf8');
      }
      return safeStorage.decryptString(data[0] === TAG_OS ? data.subarray(1) : data);
    },
  };
}
