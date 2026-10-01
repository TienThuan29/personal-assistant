import { canSelfUpdate, installUpdate, type Updater } from '../src/main/selfupdate';

const can = (platform: string, env: Record<string, string> = {}, packaged = true) => canSelfUpdate({ packaged, platform, env });

describe('canSelfUpdate', () => {
  it('is on for the Windows installer and the Linux AppImage', () => {
    expect(can('win32')).toBe(true);
    expect(can('linux', { APPIMAGE: '/x/PersonalAssistant.AppImage' })).toBe(true);
  });

  it.each([
    ['the Windows portable exe', can('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' })],
    ['Linux outside an AppImage', can('linux')],
    ['macOS (unsigned, so Squirrel.Mac refuses)', can('darwin')],
    ['an unpackaged build', can('win32', {}, false)],
  ])('is off for %s', (_n, got) => expect(got).toBe(false));
});

/** A fake updater that records its calls; `fail` names the step that rejects. */
function fake(opts: { available?: boolean; fail?: 'check' | 'download' } = {}) {
  const calls: string[] = [];
  let listener: ((p: { percent: number }) => void) | undefined;
  const u: Updater = {
    autoDownload: true,
    async checkForUpdates() {
      calls.push('check');
      if (opts.fail === 'check') throw new Error('offline');
      return { isUpdateAvailable: opts.available ?? true };
    },
    async downloadUpdate() {
      calls.push('download');
      listener?.({ percent: 41.6 });
      listener?.({ percent: 100 });
      if (opts.fail === 'download') throw new Error('sha512 mismatch');
    },
    quitAndInstall: (silent, forceRun) => void calls.push(`install ${silent} ${forceRun}`),
    on: (_e, cb) => void (listener = cb),
    removeListener: () => void (listener = undefined),
  };
  return { u, calls, listening: () => !!listener };
}

describe('installUpdate', () => {
  it('checks, downloads with progress, then restarts into the new version', async () => {
    const { u, calls, listening } = fake();
    const seen: number[] = [];
    await installUpdate(u, (p) => seen.push(p));
    expect(calls).toEqual(['check', 'download', 'install true true']);
    expect(seen).toEqual([42, 100]);
    expect(u.autoDownload).toBe(false);
    expect(listening()).toBe(false);
  });

  it.each([
    ['the check fails', { fail: 'check' as const }, ['check']],
    ['the updater finds no newer version', { available: false }, ['check']],
    ['the download fails', { fail: 'download' as const }, ['check', 'download']],
  ])('throws installFailed, installing nothing, when %s', async (_n, opts, calls) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fake(opts);
    await expect(installUpdate(f.u, () => {})).rejects.toThrow('Không cập nhật được');
    expect(f.calls).toEqual(calls);
    expect(f.listening()).toBe(false);
  });

  it('ignores a second click while the first is running, and works again afterwards', async () => {
    const f = fake();
    await Promise.all([installUpdate(f.u, () => {}), installUpdate(f.u, () => {})]);
    expect(f.calls.filter((c) => c === 'check')).toHaveLength(1);
    await installUpdate(f.u, () => {});
    expect(f.calls.filter((c) => c === 'check')).toHaveLength(2);
  });
});
