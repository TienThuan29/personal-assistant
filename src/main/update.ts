// "A newer version exists" notice (docs/update-design.md): reads the latest GitHub Release, never installs anything.
import type { Db } from './db';
import { UserError } from './errors';
import type { UpdateStatus } from '../shared/types';
import { REPO } from './installer';
import { getSetting, getUi, setSetting } from './settings';

const DAY = 24 * 60 * 60 * 1000;

type State = { checkedAt?: number; found?: string; skipped?: string };

/** 'v1.2.3' or '1.2.3' → [1, 2, 3]; anything else (pre-release tags, junk) → undefined. */
const parse = (v: string): number[] | undefined => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number);

export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  const i = a.findIndex((n, k) => n !== b[k]);
  return i >= 0 && a[i] > b[i];
}

type Opts = { fetch: typeof fetch; version: string; now: number; manual: boolean };

/**
 * Automatic (`manual` false): silent, off when the setting is off, at most one request a day (a stored result stands in
 * meanwhile) and hides a skipped version. Manual: always asks, shows a skipped version too, and throws when it cannot.
 * Everything lives in the settings row 'update', so a reloaded window shows the same banner.
 */
export async function checkForUpdate(db: Db, o: Opts): Promise<Omit<UpdateStatus, 'canInstall' | 'manualInstall'>> {
  const st = getSetting<State>(db, 'update', {});
  const result = (found: string | undefined, hideSkipped: boolean): Omit<UpdateStatus, 'canInstall' | 'manualInstall'> => {
    const latest = found && isNewer(found, o.version) && !(hideSkipped && found === st.skipped) ? found : null;
    // The link is built here, never taken from the response (a response must not choose what the app opens).
    return { current: o.version, latest, url: latest ? `https://github.com/${REPO}/releases/tag/v${latest}` : null };
  };
  if (!o.manual) {
    if (!getUi(db).checkUpdates) return result(undefined, true);
    const age = o.now - (st.checkedAt ?? -Infinity);
    if (age >= 0 && age < DAY) return result(st.found, true); // a checkedAt in the future (wrong clock) counts as stale
  }
  try {
    const res = await o.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tag = ((await res.json()) as { tag_name?: unknown }).tag_name;
    const found = typeof tag === 'string' ? parse(tag)?.join('.') : undefined;
    if (!found) throw new Error('Unexpected tag');
    setSetting(db, 'update', { ...st, checkedAt: o.now, found });
    return result(found, !o.manual);
  } catch {
    if (o.manual) throw new UserError('updateFailed');
    return result(st.found, true); // no checkedAt: the next launch tries again
  }
}

export function skipVersion(db: Db, version: unknown): void {
  const v = typeof version === 'string' ? parse(version)?.join('.') : undefined;
  if (!v) throw new UserError('invalidValue');
  setSetting(db, 'update', { ...getSetting<State>(db, 'update', {}), skipped: v });
}
