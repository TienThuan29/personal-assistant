/// <reference types="electron-vite/node" />
import { nativeImage } from 'electron';
import iconPath from '../../assets/app-icons/personal-assistant.ico?asset';

/** The app icon for the window and tray (the packaged .exe gets the same file from scripts/stamp-icon.cjs). */
export const appIcon = nativeImage.createFromPath(iconPath);
if (appIcon.isEmpty()) console.warn('App icon failed to load:', iconPath); // Electron's default icon shows instead
