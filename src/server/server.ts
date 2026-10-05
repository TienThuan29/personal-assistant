import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { attachmentFile } from '../main/attachments';
import { openData } from '../main/bootstrap';
import { createCipher } from '../main/cipher';
import { UserError } from '../main/errors';
import { registerIpc } from '../main/ipc';
import { createScheduler } from '../main/reminders';
import { loadToken } from './auth';
import { createApp, type Handler } from './http';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The browser already resized and encoded the image (docs/docker-design.md D11); only check it really is a JPEG of sane size,
 * so nothing else gets stored under an image/jpeg attachment.
 */
export function validateJpeg(bytes: unknown): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) throw new UserError('invalidImage', { mb: MAX_IMAGE_BYTES / 1024 / 1024 });
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new UserError('imageType');
  return Buffer.from(bytes);
}

// No OS keystore in a container: reports "unavailable", so createCipher uses its AES-256-GCM branch with the key in
// secrets.key (0600) on the volume (D5).
const noKeystore = {
  isEncryptionAvailable: () => false,
  encryptString: (): Buffer => {
    throw new Error('unreachable');
  },
  decryptString: (): string => {
    throw new Error('unreachable');
  },
};

export type ServerOpts = {
  dataDir: string;
  rendererDir: string;
  version: string;
  port: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
};

export type Running = { port: number; token: string; close: () => Promise<void> };

export async function startServer(o: ServerOpts): Promise<Running> {
  const { db, ro, attachmentsDir } = openData(o.dataDir, new Date());
  const token = loadToken(o.env ?? process.env, join(o.dataDir, 'token'));
  const handlers = new Map<string, Handler>();

  // `send` exists only once the app does, and the scheduler/ctx need it, so they reach it through this late binding.
  let send: (channel: string, payload?: unknown) => void = () => {};
  const scheduler = createScheduler({
    db,
    now: () => new Date(),
    notify: (rows) => {
      send('reminder', rows);
      send('data:changed');
    },
  });
  registerIpc({
    db,
    ro,
    attachmentsDir,
    secretsFile: join(o.dataDir, 'secrets.bin'),
    cipher: createCipher(noKeystore, join(o.dataDir, 'secrets.key')),
    send: (c, p) => send(c, p),
    loginItem: { get: () => false, set: () => {} },
    onDataChanged: () => {
      scheduler.refresh();
      send('data:changed');
    },
    handle: (channel, fn) => void handlers.set(channel, fn),
    toJpeg: validateJpeg,
    fetch,
    home: homedir(),
    version: o.version,
    fileSearch: false,
    canInstall: () => false,
  });

  const app = createApp({ token, rendererDir: o.rendererDir, handlers, attachment: (id) => attachmentFile(db, attachmentsDir, id) });
  send = app.send;
  await new Promise<void>((ok, fail) => {
    app.server.once('error', fail);
    app.server.listen(o.port, o.host ?? '0.0.0.0', ok);
  });
  scheduler.refresh();

  return {
    port: (app.server.address() as AddressInfo).port,
    token,
    close: async () => {
      scheduler.stop();
      app.server.closeAllConnections();
      await new Promise((ok) => app.server.close(ok));
      db.close();
      ro.close();
    },
  };
}
