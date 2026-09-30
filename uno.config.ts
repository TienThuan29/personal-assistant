import { defineConfig, presetWind3 } from 'unocss';

// Colors are the CSS variables from styles.css, so dark mode needs no `dark:` variants (design U12).
const v = (name: string) => `var(--${name})`;

export default defineConfig({
  presets: [presetWind3()],
  content: { pipeline: { include: [/src[\\/]renderer[\\/].*\.tsx($|\?)/] } },
  // Arco sets html { font-size: 14px }, so rem utilities would come out 12.5% small (w-60 = 210px). Emit px on a 16px base.
  postprocess: (util) => {
    for (const e of util.entries) if (typeof e[1] === 'string') e[1] = e[1].replace(/(-?[\d.]+)rem\b/g, (_, n) => `${Number(n) * 16}px`);
  },
  theme: {
    colors: {
      canvas: v('canvas'),
      surface: v('surface'),
      sunken: v('sunken'),
      line: v('line'),
      ink: { DEFAULT: v('ink'), 2: v('ink-2') },
      accent: { DEFAULT: v('accent'), soft: v('accent-soft'), on: v('on-accent') },
      danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
    },
    borderRadius: { card: '14px', ctl: '10px' },
    boxShadow: { card: v('shadow-card') },
  },
});
