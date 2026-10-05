import { Bell, CircleCheck, CornerDownLeft, NotebookPen, Wallet, Zap } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAPTURE_KINDS, type Capture, type CaptureKind, type CaptureResult, captureToolCall, detectKind, parseCapture, UNDO_TOOL } from '../../shared/capture';
import { addDays, parseLocalDate, toLocalDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ExpenseList } from '../../shared/types';
import { api, errorText, useUiSettings } from '../api';
import { useToast } from './Toast';
import { dayTitle, ICON, Kbd } from './ui';

const KIND_ICON: Record<CaptureKind, ReactNode> = {
  task: <CircleCheck {...ICON} />,
  reminder: <Bell {...ICON} />,
  expense: <Wallet {...ICON} />,
  note: <NotebookPen {...ICON} />,
};

/** Quick capture (docs/ui-redesign-design.md): the line, the kind, what it will become, and saving it with an Undo. */
export function useCapture(onSaved?: () => void) {
  const { t, i18n } = useTranslation(['shell', 'common']);
  const { defaultCurrency, moneyStyle } = useUiSettings();
  const toast = useToast();
  const lang = i18n.language === 'en' ? 'en' : 'vi';
  const [text, setText] = useState('');
  const [kind, setKind] = useState<CaptureKind>('task');
  const [touched, setTouched] = useState(false); // the user picked a kind: stop guessing it from the text
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  // Categories already in use (the last 90 days), so "coffee 45k" lands in the user's own "Cà phê" and not a new one.
  useEffect(() => {
    const today = toLocalDate();
    api.data
      .read<ExpenseList>('list_expenses', { from: addDays(today, -90), to: today })
      .then((r) => setCategories([...new Set(r.items.map((e) => e.category))]), () => {});
  }, []);

  const result: CaptureResult = useMemo(
    () => parseCapture(text, kind, { now: new Date(), currency: defaultCurrency, lang, categories }),
    [text, kind, defaultCurrency, lang, categories]
  );

  const change = (v: string) => {
    setText(v);
    if (!touched) setKind(detectKind(v));
  };
  const pick = (k: CaptureKind) => {
    setKind(k);
    setTouched(true);
  };
  const cycle = (back: boolean) => {
    const i = CAPTURE_KINDS.indexOf(kind);
    pick(CAPTURE_KINDS[(i + (back ? CAPTURE_KINDS.length - 1 : 1)) % CAPTURE_KINDS.length]);
  };
  const reset = () => {
    setText('');
    setKind('task');
    setTouched(false);
  };

  /** True when saved. A refusal (no amount, a past time) stays in the preview; a failed save shows main's message. */
  const submit = async (): Promise<boolean> => {
    if (saving || !result.ok) return false;
    const { tool, args } = captureToolCall(result.capture);
    setSaving(true);
    try {
      const row = (await api.data.save(tool, args)) as { id: number };
      toast(t(`shell:added.${result.capture.kind}`), {
        label: t('shell:undo'),
        run: () => void api.data.write(UNDO_TOOL[tool], { ids: [row.id] }).catch((e) => toast(errorText(e))),
      });
      reset();
      onSaved?.();
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // IME (Telex/VNI) is still composing
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      cycle(e.shiftKey);
    }
  };

  /** "Chi tiêu · 45.000 ₫ · Cà phê · Hôm nay": what Enter would save, or why it can't yet. */
  const preview = (): string => {
    if (!result.ok) return t(`shell:preview.${result.reason}`);
    const c = result.capture;
    const day = (d: string) => dayTitle(d, t);
    const at = (iso: string) => `${day(iso.slice(0, 10))} ${iso.slice(11)}`;
    const parts: Record<Capture['kind'], string[]> = {
      task: [c.kind === 'task' ? c.title : '', c.kind === 'task' ? [day(c.due_date), c.due_time].filter(Boolean).join(' ') : ''],
      reminder: [c.kind === 'reminder' ? c.message : '', c.kind === 'reminder' ? at(c.remind_at) : ''],
      expense: c.kind === 'expense' ? [formatMoney(c.amount, c.currency, moneyStyle), c.category, c.description, day(c.spent_at)] : [],
      note: [c.kind === 'note' ? c.title : ''],
    };
    return [t(`shell:kinds.${c.kind}`), ...parts[c.kind]].filter(Boolean).join(' · ');
  };

  return { text, kind, result, saving, change, pick, submit, onKeyDown, preview, reset, KIND_ICON };
}

type Capturing = ReturnType<typeof useCapture>;

/** The four "Save as" chips. */
function KindChips({ c, size = 'sm' }: { c: Capturing; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('shell');
  return (
    <div role='radiogroup' aria-label={t('capAs')} className='flex gap-1'>
      {CAPTURE_KINDS.map((k) => {
        const on = k === c.kind;
        return (
          <button
            key={k}
            type='button'
            role='radio'
            aria-checked={on}
            onClick={() => c.pick(k)}
            className={`flex items-center gap-1.5 border border-solid rounded-[7px] font-500 cursor-pointer transition ${size === 'md' ? 'h-7 px-2.5 text-[12.5px]' : 'h-7 px-[9px] text-xs'} ${
              on ? 'bg-accent-soft border-accent-line text-ink' : 'bg-transparent border-line text-ink-2 hover:text-ink'
            }`}
          >
            <span aria-hidden className={`flex text-[13px] ${on ? 'text-accent' : 'text-ink-3'}`}>{KIND_ICON[k]}</span>
            {t(`kinds.${k}`)}
          </button>
        );
      })}
    </div>
  );
}

/** The capture line of the Today page. */
export function CaptureBar() {
  const { t } = useTranslation('shell');
  const c = useCapture();
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-2.5 pl-3.5 pr-1.5 py-1.5 bg-sunken border border-solid border-line rounded-xl focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]'>
        <span aria-hidden className='flex text-base text-accent'>
          <Zap {...ICON} />
        </span>
        <input
          value={c.text}
          onChange={(e) => c.change(e.target.value)}
          onKeyDown={c.onKeyDown}
          placeholder={t('capPlaceholder')}
          aria-label={t('capture')}
          className='flex-1 min-w-0 h-[34px] border-0 bg-transparent outline-none text-sm'
        />
        <span className='hidden sm:block text-xs text-ink-3 whitespace-nowrap'>{t('capAs')}</span>
        <div className='hidden sm:block'>
          <KindChips c={c} />
        </div>
      </div>
      <div aria-live='polite' className={`min-h-[18px] px-1 text-xs ${c.text.trim() ? (c.result.ok ? 'text-ink-2' : 'text-danger') : 'text-ink-3'}`}>
        {c.text.trim() ? c.preview() : t('capHint')}
      </div>
    </div>
  );
}

/** The ⌘J overlay: the same capture, anywhere in the app. */
export function CaptureDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('shell');
  const c = useCapture(onClose);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div
      role='presentation'
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
      className='fixed inset-0 z-[1500] flex items-start justify-center pt-[9vh]'
      style={{ background: 'rgba(10,10,12,.18)' }}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('capture')}
        className='w-[min(640px,92%)] flex flex-col gap-2.5 p-3.5 bg-panel border border-solid border-line rounded-2xl shadow-lg'
        style={{ animation: 'pa-pop .18s ease-out' }}
      >
        <div className='flex items-center gap-2.5'>
          <span aria-hidden className='grid place-items-center w-8 h-8 rounded-[9px] bg-accent text-accent-on text-base'>
            <Zap {...ICON} />
          </span>
          <input
            ref={input}
            value={c.text}
            onChange={(e) => c.change(e.target.value)}
            onKeyDown={c.onKeyDown}
            placeholder={t('capPlaceholder')}
            aria-label={t('capture')}
            className='flex-1 min-w-0 h-9 border-0 bg-transparent outline-none text-[15px]'
          />
          <button
            type='button'
            aria-label={t('capSave')}
            title={t('capSave')}
            disabled={!c.result.ok || c.saving}
            onClick={() => void c.submit()}
            className='grid place-items-center w-8 h-8 border-0 rounded-lg bg-pill text-ink-2 text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:text-ink'
          >
            <CornerDownLeft {...ICON} />
          </button>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='mr-1 text-xs text-ink-3'>{t('capAs')}</span>
          <KindChips c={c} size='md' />
          <span className='flex-1' />
          <span className='flex items-center gap-1 text-[11.5px] text-ink-3'>
            <Kbd>↵</Kbd> {t('capSaveHint')} · <Kbd>Tab</Kbd> {t('capKindHint')} · <Kbd>Esc</Kbd> {t('capCloseHint')}
          </span>
        </div>
        <div aria-live='polite' className={`min-h-[18px] px-0.5 text-xs ${c.text.trim() ? (c.result.ok ? 'text-ink-2' : 'text-danger') : 'text-ink-3'}`}>
          {c.text.trim() ? c.preview() : t('capHint')}
        </div>
      </div>
    </div>
  );
}
