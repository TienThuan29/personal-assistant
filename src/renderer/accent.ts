// App colour → CSS tokens (docs/accent-color-design.md §2). Pure except applyAccent.

import { generate } from '@arco-design/color';
import { DEFAULT_UI } from '../shared/types';

type Theme = 'light' | 'dark';
type Rgb = [number, number, number];
export type Oklch = [l: number, c: number, h: number];

/** Each passes light-theme AA as is; dark is adjusted. */
export const PRESETS = [
  { key: 'terracotta', hex: '#ab502d' },
  { key: 'ocean', hex: '#2f6b86' },
  { key: 'sage', hex: '#4f6e52' },
  { key: 'plum', hex: '#7e4a72' },
  { key: 'rose', hex: '#a3485e' },
  { key: 'amber', hex: '#8a5a1c' },
  { key: 'indigo', hex: '#4e57a0' },
  { key: 'slate', hex: '#56616e' },
] as const;

// Neutrals from styles.css; gray-* are written back as "r, g, b".
const NEUTRALS: Record<Theme, Record<string, string>> = {
  light: {
    canvas: '#faf8f5', sunken: '#f3efea', line: '#e7e1d9', hover: '#f1ede8', ink: '#2b2622', 'ink-2': '#746a62',
    'gray-1': '#f7f5f2', 'gray-2': '#f1ede8', 'gray-3': '#e7e1d9', 'gray-4': '#d6cec5', 'gray-5': '#beb5ab',
    'gray-6': '#9e958b', 'gray-7': '#80776e', 'gray-8': '#635b53', 'gray-9': '#453e38', 'gray-10': '#2b2622',
  },
  dark: {
    canvas: '#1a1714', surface: '#23201c', sunken: '#1f1c19', line: '#34302b', hover: '#2a2622', ink: '#ede7e1',
    'ink-2': '#a39a91', 'color-bg-3': '#2a2622', 'color-bg-4': '#302b27', 'color-bg-5': '#36312c',
    'gray-1': '#1a1714', 'gray-2': '#23201c', 'gray-3': '#34302b', 'gray-4': '#443f39', 'gray-5': '#5a544d',
    'gray-6': '#766e66', 'gray-7': '#968d84', 'gray-8': '#b4aba2', 'gray-9': '#d2cbc4', 'gray-10': '#ede7e1',
  },
};
// --accent-soft over --surface, where accent text sits on it; on --sunken (sidebar) the app uses ink text.
const TINT = { light: 0.1, dark: 0.16 };

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

// Neutrals keep L and C with the pick's hue; near-gray picks fade them to gray.
function tint(hex: string, theme: Theme): Record<string, string> {
  const [, Cp, H] = toOklch(hex);
  const k = Math.min(1, Cp / 0.03);
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(NEUTRALS[theme])) {
    const [L, C] = toOklch(v);
    out[name] = fromOklch([L, C * k, H]);
  }
  return out;
}

function solve(hex: string, theme: Theme) {
  const n = tint(hex, theme);
  const surface = n.surface ?? '#ffffff';
  const ok = (a: string) =>
    [n.canvas, surface, mix(a, surface, TINT[theme])].every((bg) => contrast(a, bg) >= 4.5);
  const [, C, H] = toOklch(hex);
  let [L] = toOklch(hex);
  let accent = hex;
  // Light darkens, dark lightens; black / white always pass.
  while (!ok(accent) && (theme === 'light' ? L > 0 : L < 1)) {
    L = clamp(L + (theme === 'light' ? -0.005 : 0.005));
    accent = fromOklch([L, C, H]);
  }
  return { n, accent };
}

export const adjustAccent = (hex: string, theme: Theme) => solve(hex, theme).accent;

function block({ n, accent }: ReturnType<typeof solve>, theme: Theme, lightAccent: string) {
  const dark = theme === 'dark';
  // Dark ramp from the light colour, as Arco does: its step 6 lands near the lightened accent.
  const ramp = generate(dark ? lightAccent : accent, { list: true, dark, format: 'rgb' });
  const vars: Record<string, string> = {
    accent,
    'on-accent': dark ? n.canvas : '#ffffff',
    ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k.startsWith('gray-') ? triple(v) : v])),
    ...Object.fromEntries(ramp.map((c, i) => [`primary-${i + 1}`, i === 5 ? triple(accent) : c.slice(4, -1)])),
    'thought-gradient': dark
      ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--canvas)) 0%, var(--surface) 100%)'
      : 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 8%, var(--canvas)) 0%, var(--sunken) 100%)',
  };
  if (!dark) {
    const ink = triple(n.ink);
    vars['shadow-card'] = `0 1px 2px rgba(${ink}, 0.04), 0 8px 24px -12px rgba(${ink}, 0.14)`;
  }
  return Object.entries(vars).map(([k, v]) => `--${k}:${v};`).join('');
}

let last: [string, string] | undefined;

/** Two blocks overriding styles.css; '' for the default, whose tokens are hand-tuned there. */
export function accentCss(hex: string): string {
  const h = hex.toLowerCase();
  if (last?.[0] === h) return last[1];
  let css = '';
  if (h !== DEFAULT_UI.accent) {
    const light = solve(h, 'light');
    const dark = block(solve(h, 'dark'), 'dark', light.accent);
    css = `body{${block(light, 'light', light.accent)}}\nbody[arco-theme='dark']{${dark}}`;
  }
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
