import { fileURLToPath } from 'node:url';
import { startServer } from './server';

// Entry of the Docker image (bundled to out/server/index.js by scripts/build-server.mjs; the renderer sits beside it).
const port = Number(process.env.PORT ?? 3000);
const running = await startServer({
  dataDir: process.env.PA_DATA_DIR ?? './data',
  rendererDir: fileURLToPath(new URL('../renderer', import.meta.url)),
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  port,
});
// Compose may publish another host port than the container's; PA_PUBLIC_PORT says which one to print.
console.log(`Personal Assistant: http://localhost:${process.env.PA_PUBLIC_PORT ?? port}/?token=${running.token}`);

// `docker stop` sends SIGTERM and waits 10 s: close the DB cleanly (WAL checkpoint) instead of being killed.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void running.close().finally(() => process.exit(0)));
}
