import { Button, type ButtonProps, Modal, Tooltip, type TooltipProps } from '@arco-design/web-react';
import { Delete, Edit } from '@icon-park/react';
import type { Namespace, TFunction } from 'i18next';
import type { ReactNode } from 'react';
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

/** Top of a page: hint on the left, actions on the right. The page title lives in the app's top bar. */
export function PageToolbar({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
      {hint && <div className='flex-1 min-w-0 text-[13px] text-ink-2'>{hint}</div>}
      {children && <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>{children}</div>}
    </div>
  );
}

/** Replaces Arco's Empty (design §4); `children` are the call-to-action buttons. */
export function EmptyState({ icon, title, hint, children }: { icon: ReactNode; title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className='flex flex-col items-center text-center py-16'>
      <div aria-hidden className='flex items-center justify-center w-14 h-14 mb-3 rounded-full bg-accent-soft text-accent text-2xl'>{icon}</div>
      <div className='text-[15px] font-600'>{title}</div>
      {hint && <div className='mt-1 text-ink-2'>{hint}</div>}
      {children && <div className='flex flex-wrap justify-center gap-2 mt-4'>{children}</div>}
    </div>
  );
}

/** Surface card; its rows are `.list-row` (styles.css). */
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
    <section className={`bg-surface border border-line rounded-card shadow-card ${className}`}>
      {(title || action) && (
        <div className='flex items-center gap-2 px-4 pt-3 pb-2'>
          {title && (
            <h2 className='flex items-center gap-2 m-0 text-[13px] font-600'>
              {title}
              {count !== undefined && (
                <span className='min-w-5 h-5 px-1.5 rounded-full bg-pill text-ink-2 text-[11px] font-400 leading-5 text-center tabular-nums'>{count}</span>
              )}
            </h2>
          )}
          {action && <div className='ml-auto'>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const CHIP_TONES = {
  neutral: 'bg-pill text-ink-2',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
};

export function Chip({ tone = 'neutral', icon, children }: { tone?: keyof typeof CHIP_TONES; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {icon && <span aria-hidden className='flex'>{icon}</span>}
      {children}
    </span>
  );
}

export function StatCard({ icon, value, label, tone }: { icon: ReactNode; value: ReactNode; label: ReactNode; tone?: 'danger' }) {
  const danger = tone === 'danger';
  return (
    <Card className='flex items-center gap-3 p-4'>
      <div aria-hidden className={`flex shrink-0 items-center justify-center w-10 h-10 rounded-ctl text-xl ${danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}>
        {icon}
      </div>
      <div className='min-w-0'>
        <div className={`text-2xl font-600 tabular-nums leading-tight truncate ${danger ? 'text-danger' : ''}`}>{value}</div>
        <div className='text-ink-2 truncate'>{label}</div>
      </div>
    </Card>
  );
}

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
      {onEdit && <IconButton size='mini' type='text' icon={<Edit />} label={editLabel ?? t('edit')} tip={t('edit')} disabled={disabled} onClick={onEdit} />}
      <IconButton size='mini' type='text' status='danger' icon={<Delete />} label={deleteLabel} tip={t('delete')} disabled={disabled} onClick={onDelete} />
    </div>
  );
}

type ModalApi = ReturnType<typeof Modal.useModal>[0];
type ConfirmConfig = Parameters<NonNullable<ModalApi['confirm']>>[0];

/** Every destructive confirmation goes through here: a specific OK label and the danger style, so none says a bare "OK". */
export function confirmDanger(modal: ModalApi, o: Pick<ConfirmConfig, 'title' | 'content' | 'onOk'> & { okText: string }) {
  return modal.confirm?.({ ...o, okButtonProps: { status: 'danger' } });
}
