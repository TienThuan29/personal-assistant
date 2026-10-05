import { useUi } from '@aionui/ui';
import { ColorPicker } from '@arco-design/web-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adjustAccent, applyAccent, PRESETS } from '../accent';

const RAINBOW = 'conic-gradient(#e5484d, #f5a524, #46a758, #0090ff, #8e4ec6, #e5484d)';
const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The design's 6 presets + a custom picker as one radio group. Swatches show the colour as the current theme has it. */
export function AccentPicker({ value, onPick }: { value: string; onPick: (accent: string) => void }) {
  const { t } = useTranslation('settings');
  const { theme } = useUi();
  const shown = (hex: string) => adjustAccent(hex, theme);
  const swatches = useMemo(() => PRESETS.map((p) => (theme === 'dark' ? p.dark : p.hex)), [theme]); // a preset has its own dark colour
  const custom = !PRESETS.some((p) => p.hex === value);
  const group = useRef<HTMLDivElement>(null);
  const draft = useRef(value);
  const [open, setOpen] = useState(false);

  // Dragging previews; closing saves; Esc (anywhere, also in the panel's inputs) undoes.
  const close = (undo: boolean) => {
    setOpen(false);
    if (undo) applyAccent(value);
    else if (draft.current !== value) onPick(draft.current);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close(true);
      (group.current?.lastElementChild as HTMLElement | null)?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  // Roving focus; like native radios, arrows also select (the custom swatch only takes focus).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROWS[e.key];
    if (!step || !e.currentTarget.contains(e.target as Node)) return; // not keys from the picker's portal
    e.preventDefault();
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
    const i = (radios.indexOf(e.target as HTMLElement) + step + radios.length) % radios.length;
    radios[i].focus();
    if (i < PRESETS.length) onPick(PRESETS[i].hex);
  };

  const swatch = 'size-6 shrink-0 rounded-full border-0 p-0 cursor-pointer focus-visible:outline-offset-4';
  const ring = 'outline outline-2 outline-ink outline-offset-2';
  return (
    <div ref={group} role='radiogroup' aria-label={t('accent')} className='flex flex-wrap items-center gap-2' onKeyDown={onKeyDown}>
      {PRESETS.map((p, i) => (
        <button
          key={p.key}
          type='button'
          role='radio'
          aria-checked={p.hex === value}
          aria-label={t(`accentName.${p.key}`)}
          title={t(`accentName.${p.key}`)}
          tabIndex={p.hex === value ? 0 : -1}
          className={`${swatch} ${p.hex === value ? ring : ''}`}
          style={{ background: swatches[i] }}
          onClick={() => onPick(p.hex)}
        />
      ))}
      <ColorPicker
        value={value}
        disabledAlpha
        format='hex'
        popupVisible={open}
        triggerProps={{ position: 'br' }} // the swatch ends the row, at the window's right edge
        onVisibleChange={(v) => {
          if (!v) return close(false);
          draft.current = value;
          setOpen(true);
        }}
        onChange={(v) => {
          draft.current = String(v).toLowerCase();
          applyAccent(draft.current);
        }}
        triggerElement={
          <button
            type='button'
            role='radio'
            aria-checked={custom}
            aria-label={t('accentCustom')}
            title={t('accentCustom')}
            tabIndex={custom ? 0 : -1}
            className={`${swatch} ${custom ? ring : ''}`}
            style={{ background: custom ? shown(value) : RAINBOW }}
          />
        }
      />
    </div>
  );
}
