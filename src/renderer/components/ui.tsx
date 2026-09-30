import type { ReactNode } from 'react';

/** Top of a page: hint on the left, actions on the right. The page title lives in the app's top bar. */
export function PageToolbar({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
      <div className='flex-1 min-w-0 text-[13px] text-ink-2'>{hint}</div>
      {children && <div className='flex flex-wrap items-center gap-2'>{children}</div>}
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
