import { app, nativeImage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UserError } from './errors';
import type { MainCtx } from './ipc';
import { canSelfUpdate, installUpdate, type Updater } from './selfupdate';
import { revealTarget } from './tools/files';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1568;

/** PNG/JPEG → JPEG with the longest side ≤ 1568px (vision models downscale to about that anyway). */
export function toJpeg(bytes: unknown): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) throw new UserError('invalidImage', { mb: MAX_IMAGE_BYTES / 1024 / 1024 });
  let img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new UserError('imageType');
  const { width, height } = img.getSize();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' });
  return img.toJPEG(85);
}

export const desktopCanInstall = (): boolean => canSelfUpdate({ packaged: app.isPackaged, platform: process.platform, env: process.env });

/** Handlers that need Electron (Explorer, login item, self-update); the server never registers these. */
export function registerDesktopIpc(m: MainCtx): void {
  // Shows a file the assistant found in Explorer/Finder/the file manager, selected. Never opens or runs it.
  m.handle('files:reveal', async (path: unknown) => {
    if (typeof path !== 'string' || path.length > 1000) throw new UserError('invalidValue');
    shell.showItemInFolder(await revealTarget(m.home, path));
  });
  m.handle('settings:setOpenAtLogin', (on: unknown) => {
    if (typeof on !== 'boolean') throw new UserError('invalidValue');
    m.loginItem.set(on);
    return m.loginItem.get();
  });
  m.handle('update:install', () => {
    if (!m.canInstall()) throw new UserError('installFailed');
    return installUpdate(autoUpdater as unknown as Updater, (percent) => m.send('update:progress', percent));
  });
}
