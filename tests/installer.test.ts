import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadInstaller, installerName, installerUrl } from '../src/main/installer';

describe('installerName', () => {
  it('picks the macOS dmg for the CPU and the Windows portable exe', () => {
    expect(installerName({ platform: 'darwin', arch: 'arm64', env: {} })).toBe('PersonalAssistant-mac-arm64.dmg');
    expect(installerName({ platform: 'darwin', arch: 'x64', env: {} })).toBe('PersonalAssistant-mac-x64.dmg');
    expect(installerName({ platform: 'win32', arch: 'x64', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' } })).toBe('PersonalAssistant-win-x64-portable.exe');
  });

  it('has none where the app updates itself or has no file', () => {
    expect(installerName({ platform: 'win32', arch: 'x64', env: {} })).toBeUndefined();
    expect(installerName({ platform: 'linux', arch: 'x64', env: {} })).toBeUndefined();
    expect(installerName({ platform: 'darwin', arch: 'ia32', env: {} })).toBeUndefined();
  });
});

describe('installerUrl', () => {
  it('builds the release download URL and rejects odd versions', () => {
    expect(installerUrl('0.1.6', 'a.dmg')).toBe('https://github.com/TienThuan29/personal-assistant/releases/download/v0.1.6/a.dmg');
    expect(() => installerUrl('0.1.6/../../x', 'a.dmg')).toThrow();
  });
});

const body = (chunks: string[], length?: number) =>
  new Response(new ReadableStream({ start: (c) => (chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s))), c.close()) }), {
    headers: { 'content-length': String(length ?? chunks.join('').length) },
  });

describe('downloadInstaller', () => {
  it('saves the file, reports progress and opens it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inst-'));
    const seen: number[] = [];
    const opened: string[] = [];
    let url = '';
    await downloadInstaller('0.1.6', 'a.dmg', {
      fetch: (async (u: string) => ((url = u), body(['abc', 'def']))) as unknown as typeof fetch,
      dir,
      progress: (p) => seen.push(p),
      open: (f) => void opened.push(f),
    });
    expect(url).toContain('/v0.1.6/a.dmg');
    expect(await readFile(join(dir, 'a.dmg'), 'utf8')).toBe('abcdef');
    expect(seen).toEqual([50, 100]);
    expect(opened).toEqual([join(dir, 'a.dmg')]);
    expect(await readdir(dir)).toEqual(['a.dmg']);
  });

  it.each([
    ['an HTTP error', async () => new Response('x', { status: 404 })],
    ['a short download', async () => body(['abc'], 10)],
  ])('throws installFailed and leaves nothing behind on %s', async (_n, f) => {
    const dir = await mkdtemp(join(tmpdir(), 'inst-'));
    const opened: string[] = [];
    await expect(
      downloadInstaller('0.1.6', 'a.dmg', { fetch: f as unknown as typeof fetch, dir, progress: () => {}, open: (x) => void opened.push(x) }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
    expect(opened).toEqual([]);
  });
});
