import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { serverBuild } from '../scripts/server-build.config.mjs';

// esbuild would inline the `electron` package silently (it only exports a binary path) and the server would then fail at run
// time, so keep Electron out of the server's import graph (docs/docker-plan.md, "Quy tắc import").
describe('server bundle', () => {
  it('does not pull in Electron', async () => {
    const r = await build({ ...serverBuild, write: false, metafile: true, logLevel: 'silent' });
    const inputs = Object.keys(r.metafile!.inputs).map((p) => p.replaceAll('\\', '/'));
    expect(inputs.filter((p) => /node_modules\/(electron|electron-updater)\//.test(p))).toEqual([]);
    for (const desktopOnly of ['src/main/index.ts', 'src/main/icon.ts', 'src/main/ipc-desktop.ts']) expect(inputs).not.toContain(desktopOnly);
    expect(inputs).toContain('src/server/index.ts');
  });

  it('keeps node:sqlite external and defines the version', async () => {
    const r = await build({ ...serverBuild, write: false, logLevel: 'silent' });
    const code = r.outputFiles![0].text;
    expect(code).toContain('node:sqlite');
    expect(code).toContain(JSON.stringify((JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version));
  });
});
