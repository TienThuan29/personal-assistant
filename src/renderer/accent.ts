// App colour → CSS tokens (docs/accent-color-design.md §2). Pure except applyAccent.

import { generate } from '@arco-design/color';

type Theme = 'light' | 'dark';
type Rgb = [number, number, number];
export type Oklch = [l: number, c: number, h: number];

/**
 * The design's six accents (docs/ui-redesign-design.md): each has a light and a dark colour in OKLCH. The hex values are
 * worked out below, nudged only as far as needed to read at AA, so a preset is always legible.
 */
const PRESET_SOURCES = [
  { key: 'ocean', light: [0.52, 0.12, 235], dark: [0.76, 0.11, 235] },
  { key: 'terracotta', light: [0.53, 0.14, 40], dark: [0.75, 0.12, 45] },
  { key: 'sage', light: [0.5, 0.09, 155], dark: [0.77, 0.09, 155] },
  { key: 'plum', light: [0.5, 0.13, 340], dark: [0.76, 0.11, 340] },
  { key: 'indigo', light: [0.5, 0.15, 275], dark: [0.75, 0.12, 275] },
  { key: 'amber', light: [0.55, 0.12, 70], dark: [0.81, 0.12, 78] },
] as const satisfies readonly { key: string; light: Oklch; dark: Oklch }[];

// The neutrals of styles.css, which the accent has to read on (they are not emitted: styles.css owns them).
export const NEUTRALS: Record<Theme, { canvas: string; surface: string; sunken: string }> = {
  light: { canvas: '#eaeae7', surface: '#ffffff', sunken: '#f4f4f2' },
  dark: { canvas: '#0e0f11', surface: '#17181b', sunken: '#1c1d21' },
};
// --accent-soft over --surface, where accent text sits on it (styles.css mixes 11% in both themes).
const TINT = 0.11;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
const triple = (hex: string) => parse(hex).map((v) => Math.round(v * 255)).join(', ');
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// OKLab matrices: https://bottosson.github.io/posts/oklab/
export function toOklch(hex: string): Oklch {
  const [r, g, b] = parse(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function linear([L, C, H]: Oklch): Rgb {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Out-of-gamut colours keep L and H and lose chroma. */
export function fromOklch([l, c, h]: Oklch): string {
  const L = clamp(l);
  const fits = (C: number) => linear([L, C, h]).every((v) => v > -1e-4 && v < 1 + 1e-4);
  let C = c;
  if (!fits(C)) {
    let lo = 0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + C) / 2;
      if (fits(mid)) lo = mid;
      else C = mid;
    }
    C = lo;
  }
  return toHex(linear([L, C, h]).map((v) => gam(clamp(v))));
}

const luminance = (hex: string) => {
  const [r, g, b] = parse(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Like color-mix(in srgb, a p, b). */
export const mix = (a: string, b: string, p: number) => {
  const [x, y] = [parse(a), parse(b)];
  return toHex(x.map((v, i) => v * p + y[i] * (1 - p)));
};

function solve(hex: string, theme: Theme): string {
  const n = NEUTRALS[theme];
  const ok = (a: string) => [n.canvas, n.surface, mix(a, n.surface, TINT)].every((bg) => contrast(a, bg) >= 4.5);
  const [, C, H] = toOklch(hex);
  let [L] = toOklch(hex);
  let accent = hex;
  // Light darkens, dark lightens; black / white always pass.
  while (!ok(accent) && (theme === 'light' ? L > 0 : L < 1)) {
    L = clamp(L + (theme === 'light' ? -0.005 : 0.005));
    accent = fromOklch([L, C, H]);
  }
  return accent;
}

export const adjustAccent = (hex: string, theme: Theme) => solve(hex, theme);

export const PRESETS = PRESET_SOURCES.map((p) => ({
  key: p.key,
  hex: adjustAccent(fromOklch(p.light), 'light'),
  dark: adjustAccent(fromOklch(p.dark), 'dark'),
}));

function block(accent: string, theme: Theme, lightAccent: string) {
  const dark = theme === 'dark';
  // Dark ramp from the light colour, as Arco does: its step 6 lands near the lightened accent.
  const ramp = generate(dark ? lightAccent : accent, { list: true, dark, format: 'rgb' });
  const vars: Record<string, string> = {
    accent,
    'on-accent': dark ? NEUTRALS.dark.canvas : '#ffffff',
    ...Object.fromEntries(ramp.map((c, i) => [`primary-${i + 1}`, i === 5 ? triple(accent) : c.slice(4, -1)])),
  };
  return Object.entries(vars).map(([k, v]) => `--${k}:${v};`).join('');
}

let last: [string, string] | undefined;

/** Two blocks of accent variables for the light and the dark theme; they follow styles.css, which holds the neutrals. */
export function accentCss(hex: string): string {
  const h = hex.toLowerCase();
  if (last?.[0] === h) return last[1];
  const preset = PRESETS.find((p) => p.hex === h);
  const light = solve(h, 'light');
  const dark = preset ? preset.dark : solve(h, 'dark');
  const css = `body{${block(light, 'light', light)}}\nbody[arco-theme='dark']{${block(dark, 'dark', light)}}`;
  last = [h, css];
  return css;
}

/** Keeps <style id="accent"> last in <head> so it beats styles.css (Vite injects CSS in dev). */
export function applyAccent(hex: string): void {
  let el = document.getElementById('accent');
  if (!el) {
    el = document.createElement('style');
    el.id = 'accent';
  }
  if (document.head.lastElementChild !== el) document.head.append(el);
  el.textContent = accentCss(hex);
}
