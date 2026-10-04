import { Button, DatePicker } from '@arco-design/web-react';
import { Left, Plus, Right, Wallet } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toLocalDate } from '../../shared/dates';
import { breakdown, formatMoney } from '../../shared/money';
import type { ExpenseList, ExpenseRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Card, Chip, dayTitle, EmptyState, IconButton, PageToolbar, RowActions } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { ExpenseForm } from './ExpenseForm';

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function ExpensesPage() {
  const { t } = useTranslation(['pages', 'common']);
  const { moneyStyle } = useUiSettings();
  const money = (amount: number, currency: string) => formatMoney(amount, currency, moneyStyle);
  const [month, setMonth] = useState(() => toLocalDate().slice(0, 7));
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(); // undefined: closed, null: adding
  const read = useCallback(() => api.data.read<ExpenseList>('list_expenses', monthRange(month)), [month]);
  const { data, loading, busy, remove, holders } = useData<ExpenseList>(read, { items: [], totals: [] });

  const changeMonth = (m: string) => {
    setMonth(m);
    setFilter(null);
  };
  const sums = (rows: ExpenseRow[]) => breakdown(rows).map((b) => money(b.total, b.currency));
  const summary = breakdown(data.items);
  // The headline uses the SQL totals: items are capped (list_expenses), so the bar may cover only the loaded rows.
  const total = (currency: string, fallback: number) => data.totals.find((x) => x.currency === currency)?.total ?? fallback;
  // Slots 1..6 (styles.css --cat-*) by rank in the largest currency, so a category keeps its color in every bar;
  // one missing from that ranking takes the lowest slot still free in its own bar (top = 6, so one always is).
  const ranked = new Map(summary[0]?.parts.flatMap((p, i) => (p.category === null ? [] : [[p.category, i + 1] as const])));
  const slots = summary.map((b) => {
    const m = new Map<string, number>();
    const named = b.parts.flatMap((p) => (p.category === null ? [] : [p.category]));
    for (const c of named) if (ranked.has(c)) m.set(c, ranked.get(c)!);
    for (const c of named) if (!m.has(c)) m.set(c, [1, 2, 3, 4, 5, 6].find((n) => ![...m.values()].includes(n))!);
    return m;
  });
  const color = (bar: number, category: string | null) => (category === null ? 'var(--cat-other)' : `var(--cat-${slots[bar].get(category)})`);
  const active = filter !== null && data.items.some((e) => e.category === filter) ? filter : null;
  const days = new Map<string, ExpenseRow[]>();
  for (const e of [...data.items].sort((a, b) => b.spent_at.localeCompare(a.spent_at))) {
    if (active === null || e.category === active) days.set(e.spent_at, [...(days.get(e.spent_at) ?? []), e]);
  }

  const [y, m] = month.split('-');
  const addButton = (
    <Button type='primary' icon={<Plus />} onClick={() => setEditing(null)}>
      {t('common:add')}
    </Button>
  );

  return (
    <div className='page'>
      {holders}
      <PageToolbar
        hint={
          <div className='flex items-center gap-1'>
            <IconButton type='text' icon={<Left />} label={t('prevMonth')} onClick={() => changeMonth(shiftMonth(month, -1))} />
            <DatePicker.MonthPicker
              value={month}
              onChange={(v: string) => v && changeMonth(v)}
              triggerElement={
                <button type='button' className='h-8 px-2 rounded-ctl border-0 bg-transparent text-ink text-[15px] font-600 cursor-pointer hover:bg-[var(--hover)]'>
                  {t('monthLabel', { month: t(`common:monthLong.${String(Number(m)) as '1'}`), year: y })}
                </button>
              }
            />
            <IconButton type='text' icon={<Right />} label={t('nextMonth')} onClick={() => changeMonth(shiftMonth(month, 1))} />
          </div>
        }
      >
        {addButton}
      </PageToolbar>
      {loading && <Skeleton />}
      {!loading && !data.items.length && (
        <EmptyState icon={<Wallet />} title={t('noExpensesMonth')} hint={t('noExpensesHint')}>
          {addButton}
        </EmptyState>
      )}
      {summary.length > 0 && (
        <Card className='p-5 mb-4'>
          <div className='text-3xl font-600 tabular-nums'>
            {money(total(summary[0].currency, summary[0].total), summary[0].currency)}
            {summary.slice(1).map((b) => (
              <span key={b.currency} className='ml-2 text-base font-400 text-ink-2'>
                + {money(total(b.currency, b.total), b.currency)}
              </span>
            ))}
          </div>
          {summary.map((b, bar) => (
            <div key={b.currency} className='mt-4'>
              <div aria-hidden className='flex h-3 rounded-full overflow-hidden gap-[2px]'>
                {b.parts.map((p) => (
                  <div key={p.category ?? ''} style={{ flexGrow: p.share, background: color(bar, p.category) }} />
                ))}
              </div>
              <div className='grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 mt-3'>
                {b.parts.map((p) => {
                  const inner = (
                    <>
                      <span aria-hidden className='shrink-0 w-2.5 h-2.5 rounded-full' style={{ background: color(bar, p.category) }} />
                      <span className='flex-1 min-w-0 truncate'>{p.category ?? t('otherCategory')}</span>
                      <span className='tabular-nums'>{money(p.total, b.currency)}</span>
                      <span className='w-9 text-right text-ink-2 tabular-nums'>{Math.round(p.share * 100)}%</span>
                    </>
                  );
                  const row = 'flex items-center gap-2 h-8 px-2 rounded-ctl text-sm text-ink';
                  return p.category === null ? (
                    <div key='' className={row}>
                      {inner}
                    </div>
                  ) : (
                    <button
                      key={p.category}
                      type='button'
                      aria-pressed={active === p.category}
                      className={`${row} border-0 text-left cursor-pointer ${active === p.category ? 'bg-accent-soft' : 'bg-transparent hover:bg-[var(--hover)]'}`}
                      onClick={() => setFilter(active === p.category ? null : p.category)}
                    >
                      {inner}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}
      {active !== null && (
        <button type='button' aria-label={t('clearFilter', { what: active })} className='mb-3 p-0 border-0 bg-transparent cursor-pointer' onClick={() => setFilter(null)}>
          <Chip tone='accent'>✕ {active}</Chip>
        </button>
      )}
      <div className='flex flex-col gap-4'>
        {[...days].map(([day, rows]) => (
          <Card key={day} title={dayTitle(day, t)} action={<span className='text-ink-2 tabular-nums'>{sums(rows).join(' + ')}</span>}>
            {rows.map((r) => {
              const isBusy = busy.includes(r.id);
              const what = r.description || r.category;
              return (
                <div key={r.id} className='list-row'>
                  <Chip>{r.category}</Chip>
                  <div className='row-main min-w-0'>
                    <button type='button' className='link' disabled={isBusy} onClick={() => setEditing(r)}>
                      {r.description || '—'}
                    </button>
                  </div>
                  <Thumbs ids={r.attachment_ids} />
                  <span className='ml-auto tabular-nums font-500 whitespace-nowrap'>{money(r.amount, r.currency)}</span>
                  <RowActions editLabel={t('editExpenseLabel', { what })} deleteLabel={t('deleteExpense', { what })} disabled={isBusy} onEdit={() => setEditing(r)} onDelete={() => remove(r.id, 'delete_expenses', `${what}: ${money(r.amount, r.currency)}`)} />
                </div>
              );
            })}
          </Card>
        ))}
      </div>
      {editing !== undefined && (
        <ExpenseForm expense={editing} categories={data.items.map((x) => x.category)} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
