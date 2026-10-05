import { defineConfig, presetWind3 } from 'unocss';

// Colors are the CSS variables from styles.css, so dark mode needs no `dark:` variants (design U12).
const v = (name: string) => `var(--${name})`;

export default defineConfig({
  presets: [presetWind3()],
  content: { pipeline: { include: [/src[\\/]renderer[\\/].*\.tsx($|\?)/] } },
  // @aionui/ui's arco-theme.css sets html, body { font-size: var(--app-font-size, 14px) }, so rem = 14px and
  // rem utilities would come out 12.5% small (w-60 = 210px). Emit px on a 16px base.
  // The library ships same-named utilities in its own CSS; ours load later, so these px versions win app-wide.
  postprocess: (util) => {
    for (const e of util.entries) if (typeof e[1] === 'string') e[1] = e[1].replace(/(-?[\d.]+)rem\b/g, (_, n) => `${Number(n) * 16}px`);
  },
  theme: {
    colors: {
      chrome: v('chrome'),
      panel: v('panel'),
      canvas: v('canvas'),
      surface: v('surface'),
      sunken: v('sunken'),
      pill: v('pill'),
      line: v('line'),
      hover: v('hover'),
      ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
      accent: { DEFAULT: v('accent'), soft: v('accent-soft'), line: v('acc-line'), on: v('on-accent') },
      danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
      ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
    },
    fontFamily: { mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace" },
    borderRadius: { card: '12px', ctl: '9px', xl2: '16px' },
    boxShadow: { card: v('shadow-sm'), sm: v('shadow-sm'), md: v('shadow'), lg: v('shadow-lg') },
  },
});
