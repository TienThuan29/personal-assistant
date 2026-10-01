import { saveUi } from '../src/main/settings';
import { checkForUpdate, isNewer, skipVersion } from '../src/main/update';
import { testDb } from './helpers';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);

/** A fetch that answers with a release tagged `tag` (or fails) and counts its calls. */
const gh = (tag: unknown, init: { status?: number; reject?: boolean } = {}) => {
  const f = vi.fn(async () => {
    if (init.reject) throw new Error('offline');
    return new Response(JSON.stringify({ tag_name: tag, html_url: 'https://evil.example/x' }), { status: init.status ?? 200 });
  });
  return Object.assign(f, { as: f as unknown as typeof fetch });
};
const check = (db: ReturnType<typeof testDb>['db'], f: ReturnType<typeof gh>, o: { version?: string; now?: number; manual?: boolean } = {}) =>
  checkForUpdate(db, { fetch: f.as, version: '0.1.1', now: T0, manual: false, ...o });

it.each([
  ['v0.1.2', '0.1.1', true],
  ['0.2.0', '0.1.9', true],
  ['v1.0.0', '0.9.9', true],
  ['v0.1.1', '0.1.1', false],
  ['v0.1.0', '0.1.1', false],
  ['v0.10.0', '0.9.0', true],
  ['v0.2.0-beta', '0.1.1', false],
  ['latest', '0.1.1', false],
])('isNewer(%s, %s) = %s', (latest, current, want) => expect(isNewer(latest, current)).toBe(want));

describe('checkForUpdate', () => {
  it('reports a newer release with a link built from the tag, not from the response', async () => {
    const { db } = testDb();
    expect(await check(db, gh('v0.1.2'))).toEqual({ current: '0.1.1', latest: '0.1.2', url: 'https://github.com/TienThuan29/personal-assistant/releases/tag/v0.1.2' });
  });

  it('reports nothing when already up to date', async () => {
    const { db } = testDb();
    expect((await check(db, gh('v0.1.1'))).latest).toBeNull();
  });

  it('does not ask when the setting is off', async () => {
    const { db } = testDb();
    saveUi(db, { checkUpdates: false });
    const f = gh('v0.1.2');
    expect((await check(db, f)).latest).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('asks at most once a day and reuses the stored result meanwhile', async () => {
    const { db } = testDb();
    const f = gh('v0.1.2');
    await check(db, f);
    expect((await check(db, f, { now: T0 + 23 * HOUR })).latest).toBe('0.1.2');
    expect(f).toHaveBeenCalledTimes(1);
    await check(db, f, { now: T0 + 25 * HOUR });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('forgets a stored result once that version is installed', async () => {
    const { db } = testDb();
    await check(db, gh('v0.1.2'));
    expect((await check(db, gh('v0.1.2'), { version: '0.1.2', now: T0 + HOUR })).latest).toBeNull();
  });

  it('treats a checkedAt in the future as stale', async () => {
    const { db } = testDb();
    const f = gh('v0.1.2');
    await check(db, f, { now: T0 + 5 * 24 * HOUR });
    await check(db, f, { now: T0 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['offline', gh('v0.1.2', { reject: true })],
    ['rate limited', gh('v0.1.2', { status: 403 })],
    ['not a version', gh('nightly')],
    ['no tag', gh(undefined)],
  ])('stays silent on %s and tries again next time', async (_n, bad) => {
    const { db } = testDb();
    expect((await check(db, bad)).latest).toBeNull();
    const ok = gh('v0.1.2');
    expect((await check(db, ok, { now: T0 + 1 })).latest).toBe('0.1.2'); // no checkedAt was stored, so no waiting a day
  });

  it('keeps showing a stored result when a later automatic check fails', async () => {
    const { db } = testDb();
    await check(db, gh('v0.1.2'));
    expect((await check(db, gh('v0.1.2', { reject: true }), { now: T0 + 30 * HOUR })).latest).toBe('0.1.2');
  });

  it('a manual check always asks and throws when it cannot', async () => {
    const { db } = testDb();
    await check(db, gh('v0.1.2'));
    const f = gh('v0.1.2');
    expect((await check(db, f, { manual: true, now: T0 + HOUR })).latest).toBe('0.1.2');
    expect(f).toHaveBeenCalledTimes(1);
    saveUi(db, { checkUpdates: false });
    expect((await check(db, gh('v0.1.3'), { manual: true })).latest).toBe('0.1.3'); // the setting only governs automatic checks
    await expect(check(db, gh('v0.1.2', { reject: true }), { manual: true })).rejects.toThrow();
  });
});

describe('skipVersion', () => {
  it('hides that version from automatic checks only, and a later one shows again', async () => {
    const { db } = testDb();
    await check(db, gh('v0.1.2'));
    skipVersion(db, '0.1.2');
    expect((await check(db, gh('v0.1.2'), { now: T0 + HOUR })).latest).toBeNull();
    expect((await check(db, gh('v0.1.2'), { manual: true })).latest).toBe('0.1.2');
    expect((await check(db, gh('v0.1.3'), { now: T0 + 30 * HOUR })).latest).toBe('0.1.3');
  });

  it('rejects anything that is not a version', () => {
    const { db } = testDb();
    expect(() => skipVersion(db, 'x')).toThrow();
    expect(() => skipVersion(db, 5)).toThrow();
  });
});
