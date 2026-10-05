import { hasMod, shortcutLabel } from '../src/renderer/shortcuts';

describe('shortcuts', () => {
  it('needs Cmd on macOS and Ctrl elsewhere', () => {
    expect(hasMod({ ctrlKey: false, metaKey: true }, true)).toBe(true);
    expect(hasMod({ ctrlKey: true, metaKey: false }, true)).toBe(false);
    expect(hasMod({ ctrlKey: true, metaKey: false }, false)).toBe(true);
    expect(hasMod({ ctrlKey: false, metaKey: true }, false)).toBe(false);
    expect(hasMod({ ctrlKey: true, metaKey: true }, true)).toBe(false);
  });

  it('writes the hint for the platform', () => {
    expect(shortcutLabel('N', true)).toBe('⌘N');
    expect(shortcutLabel(',', false)).toBe('Ctrl+,');
  });
});
