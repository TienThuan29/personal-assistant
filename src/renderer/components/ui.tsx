import { Button, type ButtonProps, Modal, Tooltip, type TooltipProps } from '@arco-design/web-react';
import type { Namespace, TFunction } from 'i18next';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, relativeDay, toLocalDate } from '../../shared/dates';

/** Day group title: today / tomorrow / yesterday, else "weekday, d/m" ("/yyyy" outside the current year). */
export function dayTitle(date: string, t: TFunction<Namespace>): string {
  const rel = relativeDay(date, toLocalDate());
  if (rel) return t(`common:${rel}`);
  const d = parseLocalDate(date);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `/${d.getFullYear()}`;
  return `${t(`common:weekdayLong.${String(d.getDay() || 7) as '1'}`)}, ${d.getDate()}/${d.getMonth() + 1}${year}`;
}

/** The icon size every control uses (the design's 1em lucide at 15-16px). */
export const ICON = { size: '1em', strokeWidth: 1.8 } as const;

/** Top of a page: the title, a small mono note beside it, and the page's controls on the right (design: 26px / 600). */
export function PageHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className='flex flex-wrap items-center gap-3.5'>
      <h1 className='m-0 text-[26px] leading-tight font-600 tracking-[-0.02em]'>{title}</h1>
      {meta && <span className='font-mono text-xs text-ink-3'>{meta}</span>}
      {children && <div className='ml-auto flex flex-wrap items-center justify-end gap-3'>{children}</div>}
    </div>
  );
}

/** Kept for the few callers that only need a row of controls above their content. */
export function PageToolbar({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
      {hint && <div className='flex-1 min-w-0 text-[13px] text-ink-2'>{hint}</div>}
      {children && <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>{children}</div>}
    </div>
  );
}

/** Replaces Arco's Empty (design §4); `children` are the call-to-action buttons. */
export function EmptyState({ icon, title, hint, children, dashed }: { icon: ReactNode; title: ReactNode; hint?: ReactNode; children?: ReactNode; dashed?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-2.5 text-center px-5 py-16 ${dashed ? 'rounded-card border border-dashed border-line' : ''}`}>
      <div aria-hidden className='grid place-items-center w-12 h-12 rounded-full bg-accent-soft text-accent text-[22px]'>{icon}</div>
      <div className='text-base font-600'>{title}</div>
      {hint && <div className='text-[13px] text-ink-2'>{hint}</div>}
      {children && <div className='flex flex-wrap justify-center gap-2 mt-1.5'>{children}</div>}
    </div>
  );
}

/** A bordered panel; with a title it gets the design's header (title, count, actions). Its rows are `.list-row` (styles.css). */
export function Card({
  title,
  count,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-panel border border-line rounded-card overflow-hidden ${className}`}>
      {(title || action) && (
        <div className='flex items-center gap-2 px-4 py-3 border-b border-b-solid border-line'>
          {title && (
            <h2 className='flex items-center gap-2 m-0 text-sm font-600'>
              {title}
              {count !== undefined && <Count>{count}</Count>}
            </h2>
          )}
          {action && <div className='ml-auto flex items-center gap-1'>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** The scrolling body of a page: a centred column of the given width (design: 32-40px above, 44px at the sides). */
export function PageBody({ max = 920, top = 32, children }: { max?: number; top?: number; children: ReactNode }) {
  return (
    <div className='flex-1 overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
      <div className='mx-auto flex flex-col gap-5 px-11 pb-14' style={{ maxWidth: max, paddingTop: top }}>
        {children}
      </div>
    </div>
  );
}

/** The round tick of a task row; red-edged for a high-priority task, as in the design. */
export function RoundCheck({ checked, onChange, label, urgent, disabled }: { checked: boolean; onChange: () => void; label: string; urgent?: boolean; disabled?: boolean }) {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`grid place-items-center w-[18px] h-[18px] shrink-0 p-0 rounded-full border-[1.6px] border-solid text-[11px] cursor-pointer disabled:cursor-default ${
        checked ? 'border-accent bg-accent text-accent-on' : urgent ? 'border-danger bg-transparent' : 'border-ink-3 bg-transparent hover:border-accent'
      }`}
    >
      {checked && <Check {...ICON} strokeWidth={3} />}
    </button>
  );
}

/** A settings row: the label and its explanation on the left, the control on the right, a line below. */
export function SettingRow({ label, desc, children, last, stacked }: { label: ReactNode; desc?: ReactNode; children?: ReactNode; last?: boolean; stacked?: boolean }) {
  return (
    <div className={`flex gap-6 py-[18px] ${stacked ? 'flex-col gap-1.5' : 'items-center flex-wrap'} ${last ? '' : 'border-b border-b-solid border-line'}`}>
      <div className={stacked ? '' : 'flex-1 min-w-[220px]'}>
        <div className='font-500'>{label}</div>
        {desc && <div className='mt-0.5 text-[12.5px] text-ink-2'>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** The little mono number badge next to a title. */
export const Count = ({ children }: { children: ReactNode }) => (
  <span className='font-mono text-[11px] font-500 px-[7px] py-px rounded-full bg-pill text-ink-2 leading-[1.5]'>{children}</span>
);

/** Small uppercase label above a group, with its count. */
export function GroupLabel({ children, count, tone }: { children: ReactNode; count?: number; tone?: 'danger' }) {
  return (
    <div className='flex items-center gap-2 px-1'>
      <span className={`text-xs font-600 tracking-[0.04em] uppercase ${tone === 'danger' ? 'text-danger' : 'text-ink-2'}`}>{children}</span>
      {count !== undefined && <span className='font-mono text-[11px] text-ink-3'>{count}</span>}
    </div>
  );
}

const CHIP_TONES = {
  neutral: 'bg-pill text-ink-2',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  ok: 'bg-ok-soft text-ok',
};

export function Chip({ tone = 'neutral', icon, children }: { tone?: keyof typeof CHIP_TONES; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[11.5px] whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {icon && <span aria-hidden className='flex text-[11px]'>{icon}</span>}
      {children}
    </span>
  );
}

/** A figure with a label and a note under it (the Today cards). A button when it has somewhere to go. */
export function StatCard({
  icon,
  value,
  label,
  sub,
  tone,
  onClick,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  tone?: 'danger';
  onClick?: () => void;
}) {
  const danger = tone === 'danger';
  const body = (
    <>
      <span className='flex items-center gap-2 text-[12.5px] font-500 text-ink-2'>
        <span aria-hidden className={`flex text-[15px] ${danger ? 'text-danger' : 'text-accent'}`}>{icon}</span>
        {label}
      </span>
      <span className={`text-[28px] leading-none font-600 tracking-[-0.02em] tabular-nums truncate ${danger ? 'text-danger' : ''}`}>{value}</span>
      {sub !== undefined && <span className='text-xs text-ink-3 truncate'>{sub}</span>}
    </>
  );
  const box = 'flex flex-col gap-2.5 min-w-0 text-left px-[18px] py-4 bg-panel border border-solid border-line rounded-card';
  return onClick ? (
    <button type='button' onClick={onClick} className={`${box} cursor-pointer transition hover:border-accent-line hover:shadow-sm`}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'quiet' | 'danger';
  size?: 'md' | 'sm';
  icon?: ReactNode;
};
const BTN_VARIANTS = {
  primary: 'border-transparent bg-accent text-accent-on font-600 hover:brightness-110',
  default: 'border-line bg-panel text-ink font-500 hover:border-accent-line',
  quiet: 'border-transparent bg-transparent text-ink-2 font-500 hover:bg-hover hover:text-ink',
  danger: 'border-transparent bg-danger text-accent-on font-600 hover:brightness-110',
};

/** The design's button: primary (accent), default (outlined), quiet (text). Arco's Button stays inside forms and dialogs. */
export function Btn({ variant = 'default', size = 'md', icon, className = '', children, type = 'button', ...props }: BtnProps) {
  const dims = size === 'md' ? 'h-[34px] px-3.5 rounded-ctl text-[13px]' : 'h-[30px] px-3 rounded-lg text-[12.5px]';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 border border-solid cursor-pointer whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${dims} ${BTN_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {icon && <span aria-hidden className='flex text-[15px]'>{icon}</span>}
      {children}
    </button>
  );
}

/** A square icon-only button for the headers and rows of the redesigned screens; always labelled. */
export function IconBtn({ label, icon, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      className={`grid place-items-center w-8 h-8 border-0 rounded-lg bg-transparent text-ink-2 text-base cursor-pointer transition hover:bg-hover hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}

/** The design's segmented control: a sunken track, the chosen option a raised pill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role='radiogroup' aria-label={label} className={`inline-flex gap-0.5 p-[3px] rounded-ctl bg-sunken border border-solid border-line ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type='button'
            role='radio'
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 border-0 px-3 py-[5px] rounded-md text-[12.5px] font-500 cursor-pointer transition ${
              on ? 'bg-[var(--seg-on)] text-ink shadow-sm' : 'bg-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {o.icon && <span aria-hidden className='flex text-[13px]'>{o.icon}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A switch (the design's 36x20 track). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 shrink-0 p-0 border-0 rounded-[10px] cursor-pointer transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-[var(--switch-off)]'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/** A keyboard key cap. */
export const Kbd = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <kbd className={`font-mono text-[10.5px] font-500 text-ink-3 ${className}`}>{children}</kbd>
);

/**
 * Icon-only button: always an `aria-label` and the same Tooltip with it (`tip` when the tooltip should be shorter than
 * the label, e.g. "Edit" for "Edit task: Buy milk"). Use instead of a bare icon Button or a native `title`.
 */
export function IconButton({ label, tip, position, ...props }: ButtonProps & { label: string; tip?: string; position?: TooltipProps['position'] }) {
  return (
    <Tooltip content={tip ?? label} position={position}>
      <Button aria-label={label} {...props} />
    </Tooltip>
  );
}

/** Edit and delete icon buttons at the end of a list row; `onEdit` is left out where a row can only be deleted. */
export function RowActions({
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  disabled,
  className = '',
}: {
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`row-actions flex ${className}`}>
      {onEdit && <IconButton size='mini' type='text' icon={<Pencil {...ICON} />} label={editLabel ?? t('edit')} tip={t('edit')} disabled={disabled} onClick={onEdit} />}
      <IconButton size='mini' type='text' status='danger' icon={<Trash2 {...ICON} />} label={deleteLabel} tip={t('delete')} disabled={disabled} onClick={onDelete} />
    </div>
  );
}

type ModalApi = ReturnType<typeof Modal.useModal>[0];
type ConfirmConfig = Parameters<NonNullable<ModalApi['confirm']>>[0];

/** Every destructive confirmation goes through here: a specific OK label and the danger style, so none says a bare "OK". */
export function confirmDanger(modal: ModalApi, o: Pick<ConfirmConfig, 'title' | 'content' | 'onOk'> & { okText: string }) {
  return modal.confirm?.({ ...o, okButtonProps: { status: 'danger' } });
}
