import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, powerMonitor, protocol, safeStorage, shell, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { ReminderRow } from '../shared/types';
import { attachmentFile, cleanupOrphans } from './attachments';
import { backupDb, openDb } from './db';
import { registerIpc } from './ipc';
import { createScheduler } from './reminders';
import type { Cipher } from './settings';
import { pruneEmptyConversations } from './store';
import { errMsg } from './tools/common';

protocol.registerSchemesAsPrivileged([{ scheme: 'att', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const startHidden = process.argv.includes('--hidden');
let win: BrowserWindow | undefined;
let tray: Tray | undefined; // module scope keeps the tray from being garbage-collected
let quitting = false;
const notifications = new Set<Notification>(); // referenced until closed, or GC drops their click handler

/** Sends to the window unless it is gone (quit in progress). */
function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Login items only make sense for the packaged app; the portable exe exposes its real path in this env var.
const loginItemOpts = () => ({ path: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, args: ['--hidden'] });
const loginItem = {
  get: (): boolean => app.isPackaged && app.getLoginItemSettings(loginItemOpts()).openAtLogin,
  set: (openAtLogin: boolean): void => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin, ...loginItemOpts() });
  },
};

const cipher: Cipher = {
  encrypt: (s) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Hệ điều hành không hỗ trợ mã hóa (safeStorage)');
    return safeStorage.encryptString(s);
  },
  decrypt: (b) => safeStorage.decryptString(b),
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
    frame: false,
    show: !startHidden,
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
    if (d.reason !== 'clean-exit') w.webContents.reload(); // ponytail: a renderer that crashes on load reloads in a loop; add a retry cap if seen
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
      ? { title: 'Nhắc nhở', body: rows[0].message }
      : { title: `Bạn có ${rows.length} nhắc nhở`, body: rows.map((r) => `• ${r.message}`).join('\n') }
  );
  notifications.add(n);
  n.on('close', () => notifications.delete(n));
  n.on('click', () => {
    notifications.delete(n);
    showWindow();
    send('nav', 'tasks');
  });
  n.show();
  send('data:changed'); // the fired reminders changed status
}

async function createTray(): Promise<Tray> {
  const t = new Tray(await app.getFileIcon(process.execPath, { size: 'small' }));
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Mở Trợ lý', click: showWindow },
      ...(app.isPackaged
        ? [{ label: 'Khởi động cùng Windows', type: 'checkbox' as const, checked: loginItem.get(), click: () => loginItem.set(!loginItem.get()) }]
        : []),
      { type: 'separator' },
      { label: 'Thoát', click: () => app.quit() },
    ]);
  t.setToolTip('Trợ lý cá nhân');
  t.on('click', showWindow);
  t.on('right-click', () => t.popUpContextMenu(menu())); // rebuilt each time so the checkbox is current
  return t;
}

async function start(): Promise<void> {
  app.setAppUserModelId(app.isPackaged ? 'com.personal-assistant.app' : process.execPath);
  if (app.isPackaged) Menu.setApplicationMenu(null); // no DevTools/reload shortcuts
  const dataDir = app.getPath('userData');
  const dbPath = join(dataDir, 'assistant.db');
  const attachmentsDir = join(dataDir, 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });

  const db = openDb(dbPath);
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
    cipher,
    send,
    loginItem,
    onDataChanged: () => {
      scheduler.refresh();
      send('data:changed');
    },
  });

  win = createWindow();
  scheduler.refresh();
  powerMonitor.on('resume', () => scheduler.refresh());
  tray = await createTray().catch((e) => {
    console.error('Tray failed', e); // the window still works without it
    return undefined;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  void app
    .whenReady()
    .then(start)
    .catch((e) => {
      // e.g. a DB from a newer app version: say why instead of lingering as an invisible process
      dialog.showErrorBox('Không khởi động được Trợ lý', errMsg(e));
      app.exit(1);
    });
}
