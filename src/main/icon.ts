/// <reference types="electron-vite/node" />
import { nativeImage } from 'electron';
import icoPath from '../../assets/app-icons/personal-assistant.ico?asset';
import pngPath from '../../assets/app-icons/icon-256.png?asset';

/** The app icon for the window (the packaged .exe gets the same file from scripts/stamp-icon.cjs). macOS cannot decode .ico, so it uses the PNG. */
export const appIcon = nativeImage.createFromPath(process.platform === 'darwin' ? pngPath : icoPath);
if (appIcon.isEmpty()) console.warn('App icon failed to load:', process.platform === 'darwin' ? pngPath : icoPath); // Electron's default icon shows instead

/** The tray / menu-bar icon: the menu bar wants about 18 px tall. */
export const trayIcon = process.platform === 'darwin' ? appIcon.resize({ height: 18 }) : appIcon;
