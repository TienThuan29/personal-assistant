import { appMenuTemplate, chromeOptions } from '../src/main/chrome';

describe('chromeOptions', () => {
  it('keeps the native traffic lights on macOS', () => {
    const o = chromeOptions('darwin');
    expect(o.titleBarStyle).toBe('hiddenInset');
    expect(o.trafficLightPosition).toBeDefined();
    expect(o.frame).toBeUndefined();
  });

  it.each(['win32', 'linux'])('is frameless on %s', (p) => expect(chromeOptions(p)).toEqual({ frame: false }));
});

describe('appMenuTemplate', () => {
  it('gives macOS app, edit and window menus (Cmd+Q, copy/paste) but no View menu with DevTools', () => {
    const roles = appMenuTemplate('darwin')?.map((m) => m.role);
    expect(roles).toEqual(['appMenu', 'editMenu', 'windowMenu']);
  });

  it.each(['win32', 'linux'])('has no menu on %s', (p) => expect(appMenuTemplate(p)).toBeNull());
});
