import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const COOKIE = 'pa_token';

/** PA_TOKEN if set, else the token saved in `file`, else a new random one saved there (0600) so the URL survives restarts. */
export function loadToken(env: NodeJS.ProcessEnv, file: string): string {
  const fromEnv = env.PA_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  }
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export const sameToken = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Only loopback names: a DNS-rebinding page reaches this server under its own hostname. Any port (compose maps one). */
export const hostOk = (host: string | undefined): boolean => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? '');

/** Browsers always send Origin on POST; a missing one is a non-browser client, which still needs the cookie. */
export const originOk = (origin: string | undefined, host: string | undefined): boolean =>
  origin === undefined || (host !== undefined && origin === `http://${host}`);

export const cookieHeader = (token: string): string => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
