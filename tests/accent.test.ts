import { PRESETS, accentCss, adjustAccent, contrast, fromOklch, mix, toOklch } from '../src/renderer/accent';
import { DEFAULT_UI } from '../src/shared/types';

// Reads back what applyAccent would inject: { light: {name: value}, dark: {...} }.
function parseCss(css: string) {
  const [light, dark] = css.split("body[arco-theme='dark']");
  const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]]));
  return { light: vars(light), dark: vars(dark) };
}

const lab = (hex: string) => {
  const [L, C, H] = toOklch(hex);
  return [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
};
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => (v - lab(b)[i]) * 100));

const PICKS = [...PRESETS.map((p) => p.hex).slice(1), '#ffff00', '#000080', '#000000', '#ffffff', '#00ff00', '#808080', '#3366aa'];

describe('accent', () => {
  it.each(PICKS)('%s reads at AA in both themes', (hex) => {
    const css = parseCss(accentCss(hex));
    for (const [theme, v] of Object.entries(css)) {
      const surface = theme === 'light' ? '#ffffff' : v.surface;
      const tint = mix(v.accent, surface, theme === 'light' ? 0.1 : 0.16);
      for (const bg of [v.canvas, surface, tint]) expect(contrast(v.accent, bg), `${theme} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['on-accent'], v.accent), `${theme} on-accent`).toBeGreaterThanOrEqual(4.5);
      expect(v['primary-6']).toBe(v.accent.slice(1).match(/../g)!.map((x) => parseInt(x, 16)).join(', '));
      expect(Object.keys(v).filter((k) => /^(primary|gray)-\d+$/.test(k))).toHaveLength(20);
    }
  });

  it('injects nothing for the default', () => {
    expect(accentCss(DEFAULT_UI.accent)).toBe('');
    expect(accentCss(DEFAULT_UI.accent.toUpperCase())).toBe('');
  });

  it('keeps presets as they are in the light theme', () => {
    expect(PRESETS[0]).toEqual({ key: 'terracotta', hex: DEFAULT_UI.accent });
    expect(PRESETS).toHaveLength(8);
    for (const p of PRESETS) expect(adjustAccent(p.hex, 'light')).toBe(p.hex);
  });

  it('tints the canvas by hue only', () => {
    // '#ab502e': terracotta's hue without hitting the default's early return.
    expect(deltaE(parseCss(accentCss('#ab502e')).light.canvas, '#faf8f5')).toBeLessThan(2);
    expect(toOklch(parseCss(accentCss('#808080')).light.canvas)[1]).toBeLessThan(0.002);
  });

  it('round-trips through OKLCH', () => {
    for (const hex of ['#ab502d', '#faf8f5', '#000000', '#ffffff', '#00ff00', '#3366aa', '#808080']) expect(fromOklch(toOklch(hex))).toBe(hex);
  });

  it('clamps out-of-gamut colours by chroma', () => {
    const out = fromOklch([0.7, 0.4, 145]);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(toOklch(out)[0]).toBeCloseTo(0.7, 2);
  });
});
