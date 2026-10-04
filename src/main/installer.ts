// Hand-installed updates for builds electron-updater cannot replace: macOS (unsigned, so Squirrel.Mac refuses) and the
// Windows portable exe. Downloads the right file of the release into Downloads and opens it (docs/update-design.md).
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { UserError } from './errors';

export const REPO = 'TienThuan29/personal-assistant';

type Env = Record<string, string | undefined>;

/** The release file for this build, named as in electron-builder.yml; undefined where the app updates itself or has no file. */
export function installerName(o: { platform: string; arch: string; env: Env }): string | undefined {
  if (o.platform === 'darwin') return o.arch === 'arm64' || o.arch === 'x64' ? `PersonalAssistant-mac-${o.arch}.dmg` : undefined;
  if (o.platform === 'win32' && o.env.PORTABLE_EXECUTABLE_FILE) return 'PersonalAssistant-win-x64-portable.exe';
  return undefined;
}

/** Only a plain x.y.z reaches the URL, so a odd tag cannot point the download elsewhere. */
export function installerUrl(version: string, name: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Bad version ${version}`);
  return `https://github.com/${REPO}/releases/download/v${version}/${name}`;
}

type Deps = { fetch: typeof fetch; dir: string; progress: (percent: number) => void; open: (file: string) => Promise<unknown> | void };

let running = false;

/** Downloads `name` of release `version` into `dir` (via a .part file) and hands the finished file to `open`. Any failure throws installFailed. */
export async function downloadInstaller(version: string, name: string, d: Deps): Promise<void> {
  if (running) return;
  running = true;
  const file = join(d.dir, name);
  const part = `${file}.part`;
  try {
    const res = await d.fetch(installerUrl(version, name));
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = createWriteStream(part);
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (total) d.progress(Math.min(100, Math.round((got / total) * 100)));
      }
      await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
    } catch (e) {
      out.destroy();
      throw e;
    }
    if (total && got !== total) throw new Error(`Got ${got} of ${total} bytes`);
    await rename(part, file);
    await d.open(file);
  } catch (e) {
    console.error('Installer download failed', e);
    await rm(part, { force: true });
    throw new UserError('installFailed');
  } finally {
    running = false;
  }
}
