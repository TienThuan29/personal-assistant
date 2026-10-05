import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

/** esbuild options of the Docker server bundle; every package is inlined, so the image needs no node_modules. */
export const serverBuild = {
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'out/server/index.js',
  external: ['node:sqlite'], // too new for esbuild's builtin list
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Some bundled packages call require() on Node builtins, which ESM output lacks.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};
