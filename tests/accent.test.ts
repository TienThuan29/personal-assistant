import { NEUTRALS, PRESETS, accentCss, adjustAccent, contrast, fromOklch, mix, toOklch } from '../src/renderer/accent';
import { DEFAULT_UI } from '../src/shared/types';

// Reads back what applyAccent would inject: { light: {name: value}, dark: {...} }.
function parseCss(css: string) {
  const [light, dark] = css.split("body[arco-theme='dark']");
  const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):([^;]+);/g)].map((m) => [m[1], m[2]]));
  return { light: vars(light), dark: vars(dark) };
}

const PICKS = [...PRESETS.map((p) => p.hex), '#ffff00', '#000080', '#000000', '#ffffff', '#00ff00', '#808080', '#3366aa'];

describe('accent', () => {
  it.each(PICKS)('%s reads at AA in both themes', (hex) => {
    const css = parseCss(accentCss(hex));
    for (const [theme, v] of Object.entries(css) as ['light' | 'dark', Record<string, string>][]) {
      const n = NEUTRALS[theme];
      const tint = mix(v.accent, n.surface, 0.11);
      for (const bg of [n.canvas, n.surface, tint]) expect(contrast(v.accent, bg), `${theme} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['on-accent'], v.accent), `${theme} on-accent`).toBeGreaterThanOrEqual(4.5);
      expect(v['primary-6']).toBe(v.accent.slice(1).match(/../g)!.map((x) => parseInt(x, 16)).join(', '));
      expect(Object.keys(v).filter((k) => /^primary-\d+$/.test(k))).toHaveLength(10);
    }
  });

  it('has the design six, ocean first, and the default is ocean', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['ocean', 'terracotta', 'sage', 'plum', 'indigo', 'amber']);
    expect(DEFAULT_UI.accent).toBe(PRESETS[0].hex);
  });

  it('keeps a preset as it is in the light theme and uses its own dark colour', () => {
    for (const p of PRESETS) {
      expect(adjustAccent(p.hex, 'light')).toBe(p.hex);
      expect(parseCss(accentCss(p.hex)).dark.accent).toBe(p.dark);
    }
  });

  it('solves a custom colour for the dark theme on its own', () => {
    const dark = parseCss(accentCss('#3366aa')).dark.accent;
    expect(PRESETS.map((p) => p.dark)).not.toContain(dark);
    expect(toOklch(dark)[0]).toBeGreaterThan(toOklch('#3366aa')[0]); // lightened to read on the dark surface
  });

  it('does not emit neutrals: styles.css owns them', () => {
    const { light } = parseCss(accentCss('#3366aa'));
    expect(Object.keys(light).filter((k) => !/^(accent|on-accent|primary-\d+)$/.test(k))).toEqual([]);
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
