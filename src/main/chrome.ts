// Platform-specific window chrome (issue #6): macOS keeps its traffic lights, the others draw their own buttons.
import type { MenuItemConstructorOptions } from 'electron';

/** BrowserWindow options for the title bar. On macOS the native buttons sit inset at the top-left; elsewhere the window is frameless. */
export function chromeOptions(platform: string): { frame?: false; titleBarStyle?: 'hiddenInset'; trafficLightPosition?: { x: number; y: number } } {
  return platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 } } : { frame: false };
}

/**
 * The application menu: none on Windows/Linux (no DevTools or reload shortcuts). macOS needs one: Cmd+Q, Cmd+H, Cmd+W
 * and copy/paste come from it. No View menu, so still no DevTools.
 */
export function appMenuTemplate(platform: string): MenuItemConstructorOptions[] | null {
  return platform === 'darwin' ? [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }] : null;
}
