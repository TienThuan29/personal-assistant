import { app, nativeImage, nativeTheme, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UserError } from './errors';
import { downloadInstaller, installerName } from './installer';
import type { MainCtx } from './ipc';
import { canSelfUpdate, installUpdate, type Updater } from './selfupdate';
import { revealTarget } from './tools/files';
import { checkForUpdate } from './update';
import type { UiSettings } from '../shared/types';

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

const autoInstall = () => canSelfUpdate({ packaged: app.isPackaged, platform: process.platform, env: process.env });
// macOS and the Windows portable exe cannot replace themselves: download the file and open it instead (installer.ts)
const manualFile = () => (app.isPackaged ? installerName({ platform: process.platform, arch: process.arch, env: process.env }) : undefined);

export const desktopInstallMode = (): { canInstall: boolean; manualInstall: boolean } => ({
  canInstall: autoInstall() || !!manualFile(),
  manualInstall: !autoInstall() && !!manualFile(),
});

export const setTheme = (theme: UiSettings['theme']): void => {
  nativeTheme.themeSource = theme;
};

/** Handlers that need Electron (Explorer, login item, self-update, data folder); the server never registers these. */
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
  m.handle('settings:dataPath', () => app.getPath('userData'));
  m.handle('settings:revealData', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
  });
  m.handle('update:install', async () => {
    if (autoInstall()) return installUpdate(autoUpdater as unknown as Updater, (percent) => m.send('update:progress', percent));
    const name = manualFile();
    if (!name) throw new UserError('installFailed');
    const { latest } = await checkForUpdate(m.db, { fetch: m.fetch, version: m.version, now: Date.now(), manual: true }).catch(() => ({ latest: null }));
    if (!latest) throw new UserError('installFailed');
    await downloadInstaller(latest, name, {
      fetch: m.fetch,
      dir: app.getPath('downloads'),
      progress: (percent) => m.send('update:progress', percent),
      open: async (file) => {
        if (process.platform === 'darwin') {
          await shell.openPath(file); // mounts the .dmg; the running app cannot be replaced, so quit and let the user drag it over
          app.quit();
        } else shell.showItemInFolder(file);
      },
    });
  });
}
