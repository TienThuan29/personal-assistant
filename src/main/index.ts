import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, Notification, powerMonitor, protocol, safeStorage, shell, Tray } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type { ReminderRow } from '../shared/types';
import { attachmentFile, cleanupOrphans } from './attachments';
import { backupDb, openDb } from './db';
import { appMenuTemplate, chromeOptions } from './chrome';
import { appIcon, trayIcon } from './icon';
import { i18n, setLanguage } from './i18n';
import { registerIpc } from './ipc';
import { createScheduler } from './reminders';
import { createCipher } from './cipher';
import { getUi } from './settings';
import { pruneEmptyConversations } from './store';
import { errMsg, te } from './errors';

protocol.registerSchemesAsPrivileged([{ scheme: 'att', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | undefined;
let tray: Tray | undefined; // module scope keeps the tray from being garbage-collected
let quitting = false;
const notifications = new Set<Notification>(); // referenced until clicked (capped), or GC drops their click handler

/** Sends to the window unless it is gone (quit in progress). */
function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Login items only make sense for the packaged app; the NSIS install path (process.execPath, the default) is stable.
const loginArgs = ['--hidden'];
const loginItem = {
  get: (): boolean => app.isPackaged && app.getLoginItemSettings({ args: loginArgs }).openAtLogin,
  set: (openAtLogin: boolean): void => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin, args: loginArgs });
  },
};

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    ...chromeOptions(process.platform),
    show: !startHidden,
    icon: appIcon,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
  });
  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide(); // keep running in the tray so reminders still fire
  });
  w.on('closed', () => {
    win = undefined;
  });
  w.on('maximize', () => w.webContents.send('win:maximized', true));
  w.on('unmaximize', () => w.webContents.send('win:maximized', false));
  w.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit' && !w.isDestroyed()) w.webContents.reload(); // ponytail: a renderer that crashes on load reloads in a loop; add a retry cap if seen
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const indexHtml = join(__dirname, '../renderer/index.html');
  // Only the app itself, not any other page (it would get window.api).
  const isApp = (url: string): boolean =>
    devUrl ? URL.canParse(url) && new URL(url).origin === new URL(devUrl).origin : url.split('#')[0] === pathToFileURL(indexHtml).href;
  w.webContents.on('will-navigate', (e, url) => {
    if (!isApp(url)) e.preventDefault();
  });
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(indexHtml);
  return w;
}

function notify(rows: ReminderRow[]): void {
  const n = new Notification(
    rows.length === 1
      ? { title: i18n.t('system:reminder'), body: rows[0].message }
      : { title: i18n.t('system:reminders', { count: rows.length }), body: rows.map((r) => `• ${r.message}`).join('\n') }
  );
  notifications.add(n); // no 'close' cleanup: Windows fires it when the toast moves to Action Center, where it can still be clicked
  if (notifications.size > 50) notifications.delete(notifications.values().next().value!);
  n.on('click', () => {
    notifications.delete(n);
    showWindow();
    send('nav', 'today');
  });
  n.show();
  send('data:changed'); // the fired reminders changed status
}

async function createTray(): Promise<Tray> {
  const t = new Tray(trayIcon);
  const menu = () =>
    Menu.buildFromTemplate([
      { label: i18n.t('system:open'), click: showWindow },
      ...(app.isPackaged
        ? [{ label: i18n.t('system:openAtLogin'), type: 'checkbox' as const, checked: loginItem.get(), click: () => loginItem.set(!loginItem.get()) }]
        : []),
      { type: 'separator' },
      { label: i18n.t('system:quit'), click: () => app.quit() },
    ]);
  t.setToolTip(i18n.t('system:tooltip'));
  i18n.on('languageChanged', () => t.setToolTip(i18n.t('system:tooltip')));
  t.on('click', showWindow);
  t.on('right-click', () => t.popUpContextMenu(menu())); // rebuilt each time so the checkbox is current
  return t;
}

async function start(): Promise<void> {
  app.setAppUserModelId(app.isPackaged ? 'com.personal-assistant.app' : process.execPath);
  if (app.isPackaged) {
    const template = appMenuTemplate(process.platform);
    Menu.setApplicationMenu(template && Menu.buildFromTemplate(template)); // null: no DevTools/reload shortcuts
  }
  const dataDir = app.getPath('userData');
  const dbPath = join(dataDir, 'assistant.db');
  const attachmentsDir = join(dataDir, 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });

  const db = openDb(dbPath);
  setLanguage(getUi(db).language);
  const ro = new DatabaseSync(dbPath, { readOnly: true });
  try {
    backupDb(db, join(dataDir, 'backups'), new Date());
  } catch (e) {
    console.error('Backup failed, continuing without it', e); // a backup must never block startup
  }
  pruneEmptyConversations(db);
  cleanupOrphans(db, attachmentsDir);

  protocol.handle('att', (req) => {
    const f = attachmentFile(db, attachmentsDir, new URL(req.url).hostname);
    return f ? net.fetch(pathToFileURL(f.path).toString()) : new Response('Not found', { status: 404 });
  });

  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.handle('win:close', () => win?.close());
  ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false);

  const scheduler = createScheduler({ db, now: () => new Date(), notify });
  registerIpc({
    db,
    ro,
    attachmentsDir,
    secretsFile: join(dataDir, 'secrets.bin'),
    cipher: createCipher(safeStorage, join(dataDir, 'secrets.key')),
    send,
    loginItem,
    onDataChanged: () => {
      scheduler.refresh();
      send('data:changed');
    },
  });

  // Dev-only: PA_THEME=light|dark overrides the OS theme; the renderer's prefers-color-scheme follows.
  if (!app.isPackaged && (process.env.PA_THEME === 'light' || process.env.PA_THEME === 'dark')) nativeTheme.themeSource = process.env.PA_THEME;
  win = createWindow();
  // Dev-only: PA_SCREENSHOT=<file.png> [PA_PAGE=<page>] [PA_SCREENSHOT_DELAY=<ms>] [PA_THEME=light|dark] saves a capture of the window, then quits.
  const shot = process.env.PA_SCREENSHOT;
  if (!app.isPackaged && shot) {
    const w = win;
    w.webContents.once('did-finish-load', async () => {
      try {
        await sleep(Number(process.env.PA_SCREENSHOT_DELAY ?? 2500)); // nav earlier loses to the app opening the latest chat
        if (process.env.PA_PAGE) send('nav', process.env.PA_PAGE);
        await sleep(300);
        let img = await w.capturePage();
        for (let i = 0; i < 5 && img.isEmpty(); i++) {
          await sleep(500); // the window may not have painted yet
          img = await w.capturePage();
        }
        if (img.isEmpty()) throw new Error('Screenshot is empty');
        writeFileSync(shot, img.toPNG());
        app.exit(0);
      } catch (e) {
        console.error(e);
        app.exit(1);
      }
    });
  }
  scheduler.refresh();
  powerMonitor.on('resume', () => scheduler.refresh());
  tray = await createTray().catch((e) => {
    console.error('Tray failed', e); // the window still works without it
    return undefined;
  });
}

/**
 * Resolves true once this process holds the single-instance lock.
 * Dev only: a new launch takes over from the running instance (see 'second-instance' below), so it retries
 * while the old one quits. Otherwise an old dev main/preload left in the tray gets Vite's new renderer
 * hot-loaded into it, and preload APIs it lacks white-screen the window. Packaged builds focus the old window.
 */
async function acquireLock(): Promise<boolean> {
  if (app.requestSingleInstanceLock()) return true;
  if (app.isPackaged) return false;
  for (let i = 0; i < 40; i++) {
    await sleep(250); // a failed attempt releases its handle, so asking again is allowed
    if (app.requestSingleInstanceLock()) return true;
  }
  console.error('The running instance did not quit within 10s; quitting instead.');
  return false;
}

void acquireLock().then((locked) => {
  if (!locked) return app.quit();
  app.on('second-instance', () => {
    if (app.isPackaged) return showWindow();
    quitting = true; // dev: step aside for the newer launch
    app.quit();
  });
  app.on('activate', showWindow); // macOS: Dock icon click brings back the window the close button hid
  app.on('before-quit', () => {
    quitting = true;
  });
  return app
    .whenReady()
    .then(start)
    .catch((e) => {
      // e.g. a DB from a newer app version: say why instead of lingering as an invisible process
      dialog.showErrorBox(te('startupFailed'), errMsg(e));
      app.exit(1);
    });
});
