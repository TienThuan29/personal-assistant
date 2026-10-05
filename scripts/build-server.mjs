import { build } from 'esbuild';
import { serverBuild } from './server-build.config.mjs';

await build(serverBuild);
