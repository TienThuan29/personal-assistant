// Download and install of a newer release (docs/update-design.md U12–U17). Whether there is one is update.ts's job;
// this only runs when the user clicks "Update and restart". The updater is passed in so tests can fake it.
import { UserError } from './errors';

/** The slice of electron-updater's AppUpdater used here. */
export type Updater = {
  autoDownload: boolean;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent: boolean, forceRun: boolean): void;
  on(event: 'download-progress', cb: (p: { percent: number }) => void): unknown;
  removeListener(event: 'download-progress', cb: (p: { percent: number }) => void): unknown;
};

/** electron-updater handles only the NSIS install on Windows and AppImage on Linux (not portable, not macOS without signing). */
export const canSelfUpdate = (o: { packaged: boolean; platform: string; env: Record<string, string | undefined> }): boolean =>
  o.packaged && ((o.platform === 'win32' && !o.env.PORTABLE_EXECUTABLE_FILE) || (o.platform === 'linux' && !!o.env.APPIMAGE));

let installing = false;

/** Finds the release's update file, downloads it (percent via `progress`) and restarts into it. Any failure throws installFailed. */
export async function installUpdate(u: Updater, progress: (percent: number) => void): Promise<void> {
  if (installing) return; // a second click while the first is downloading
  installing = true;
  const onProgress = (p: { percent: number }) => progress(Math.round(p.percent));
  try {
    u.autoDownload = false;
    u.on('download-progress', onProgress);
    if (!(await u.checkForUpdates())?.isUpdateAvailable) throw new Error('No update file for a newer version');
    await u.downloadUpdate();
    u.quitAndInstall(true, true); // silent, and start the app again afterwards
  } catch (e) {
    console.error('Self-update failed', e);
    throw new UserError('installFailed');
  } finally {
    u.removeListener('download-progress', onProgress);
    installing = false;
  }
}
