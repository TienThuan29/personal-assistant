import { DatePicker } from '@arco-design/web-react';
import { Car, ChevronLeft, ChevronRight, Coffee, HeartPulse, type LucideIcon, Plus, Receipt, ShoppingBag, Ticket, Utensils, Wallet, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryKeyOf } from '../../shared/capture';
import { toLocalDate } from '../../shared/dates';
import { breakdown, formatMoney } from '../../shared/money';
import type { ExpenseList, ExpenseRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Btn, Card, dayTitle, EmptyState, GroupLabel, ICON, IconBtn, PageBody, PageHeader, RowActions } from '../components/ui';
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
const TREND_MONTHS = 6;

const ICONS: Record<string, LucideIcon> = { food: Utensils, transport: Car, shopping: ShoppingBag, bills: Receipt, coffee: Coffee, health: HeartPulse, fun: Ticket, other: Wallet };

type Months = { month: string; currency: string; total: number }[];
type Data = ExpenseList & { months: Months };

/** "6.1M" / "6,1 tr": a month's total as the trend bars show it, in major units. */
const compact = (minor: number, currency: string, lang: string): string => {
  const major = minor / 10 ** (currency === 'VND' ? 0 : 2);
  if (currency === 'VND') {
    const m = major / 1e6;
    return lang === 'en' ? `${m.toFixed(1)}M` : `${m.toFixed(1).replace('.', ',')} tr`;
  }
  return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(major);
};

export function ExpensesPage() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { moneyStyle, defaultCurrency } = useUiSettings();
  const lang = i18n.language === 'en' ? 'en' : 'vi';
  const money = (amount: number, currency: string) => formatMoney(amount, currency, moneyStyle);
  const [month, setMonth] = useState(() => toLocalDate().slice(0, 7));
  const [filter, setFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(); // undefined: closed, null: adding
  const read = useCallback(async (): Promise<Data> => {
    const [list, months] = await Promise.all([
      api.data.read<ExpenseList>('list_expenses', monthRange(month)),
      api.data.read<Months>('expense_months', { to: month, months: TREND_MONTHS + 1 }), // one more, to compare with the month before the first bar
    ]);
    return { ...list, months };
  }, [month]);
  const { data, loading, busy, remove, holders } = useData<Data>(read, { items: [], totals: [], months: [] });

  const changeMonth = (m: string) => {
    setMonth(m);
    setFilter(null);
  };
  const sums = (rows: ExpenseRow[]) => breakdown(rows).map((b) => money(b.total, b.currency));
  const summary = breakdown(data.items);
  // The headline uses the SQL totals: items are capped (list_expenses), so the bar may cover only the loaded rows.
  const total = (currency: string, fallback: number) => data.totals.find((x) => x.currency === currency)?.total ?? fallback;
  // Slots 1..6 (--cat-*) by rank in the largest currency, so a category keeps its color in every bar;
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

  // The trend is in one currency: the month's biggest, or the default one in an empty month.
  const trendCurrency = summary[0]?.currency ?? defaultCurrency;
  const monthTotal = (m: string) => data.months.find((x) => x.month === m && x.currency === trendCurrency)?.total ?? 0;
  const bars = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(month, i - (TREND_MONTHS - 1)));
  const peak = Math.max(1, ...bars.map(monthTotal));
  const prev = monthTotal(shiftMonth(month, -1));
  const delta = prev > 0 ? Math.round(((total(trendCurrency, 0) - prev) / prev) * 100) : null;
  const monthName = (m: string, short = false) => {
    const [yy, mm] = m.split('-');
    return short ? t(`common:monthShort.${String(Number(mm)) as '1'}`) : t('monthLabel', { month: t(`common:monthLong.${String(Number(mm)) as '1'}`), year: yy });
  };

  const addButton = (
    <Btn variant='primary' icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
      {t('addExpense')}
    </Btn>
  );

  return (
    <PageBody max={1000}>
      {holders}
      <PageHeader title={t('common:nav.expenses')}>
        <div className='flex items-center gap-0.5 p-0.5 border border-solid border-line rounded-ctl'>
          <IconBtn label={t('prevMonth')} icon={<ChevronLeft {...ICON} />} className='!w-7 !h-7 !rounded-md' onClick={() => changeMonth(shiftMonth(month, -1))} />
          <DatePicker.MonthPicker
            value={month}
            onChange={(v: string) => v && changeMonth(v)}
            triggerElement={
              <button type='button' className='min-w-[132px] h-7 border-0 rounded-md bg-transparent text-ink text-[13px] font-600 cursor-pointer hover:bg-hover'>
                {monthName(month)}
              </button>
            }
          />
          <IconBtn label={t('nextMonth')} icon={<ChevronRight {...ICON} />} className='!w-7 !h-7 !rounded-md' onClick={() => changeMonth(shiftMonth(month, 1))} />
        </div>
        {addButton}
      </PageHeader>

      {loading && <Skeleton />}
      {!loading && !data.items.length && (
        <EmptyState dashed icon={<Wallet {...ICON} />} title={t('noExpensesMonth')} hint={t('noExpensesHint')}>
          {addButton}
        </EmptyState>
      )}

      {summary.length > 0 && (
        <>
          <div className='grid gap-4 [grid-template-columns:minmax(0,1fr)_minmax(0,1.3fr)]'>
            <div className='flex flex-col gap-1.5 px-[22px] py-5 border border-solid border-line rounded-card'>
              <div className='text-[12.5px] font-500 text-ink-2'>{t('spentIn', { month: monthName(month) })}</div>
              <div className='text-[38px] leading-[1.1] font-600 tracking-[-0.03em] tabular-nums'>
                {money(total(summary[0].currency, summary[0].total), summary[0].currency)}
              </div>
              {summary.slice(1).map((b) => (
                <div key={b.currency} className='text-base tabular-nums text-ink-2'>
                  + {money(total(b.currency, b.total), b.currency)}
                </div>
              ))}
              <div className='flex items-center gap-2 mt-1'>
                <span className='text-[12.5px] text-ink-3'>{t('expenseCount', { count: data.items.length })}</span>
                {delta !== null && (
                  <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-500 ${delta > 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>{t('vsLastMonth', { delta: `${delta > 0 ? '+' : ''}${delta}%` })}</span>
                )}
              </div>
            </div>
            <div className='flex flex-col gap-2.5 px-5 pt-4 pb-3 border border-solid border-line rounded-card'>
              <div className='text-[12.5px] font-500 text-ink-2'>{t('lastMonths', { count: TREND_MONTHS })}</div>
              <div className='h-[110px] grid grid-cols-6 gap-3.5 items-end'>
                {bars.map((m) => {
                  const v = monthTotal(m);
                  const now = m === month;
                  return (
                    <button
                      key={m}
                      type='button'
                      title={money(v, trendCurrency)}
                      aria-label={`${monthName(m)}: ${money(v, trendCurrency)}`}
                      onClick={() => changeMonth(m)}
                      className='h-full flex flex-col justify-end items-stretch gap-1.5 p-0 border-0 bg-transparent cursor-pointer'
                    >
                      <span className={`font-mono text-[11px] font-500 text-center ${now ? 'text-ink' : 'text-ink-3'}`}>{v ? compact(v, trendCurrency, lang) : ''}</span>
                      <span
                        className={`rounded-[5px_5px_2px_2px] transition-[height] duration-[350ms] ${now ? 'bg-accent' : 'bg-[var(--bar)]'}`}
                        style={{ height: `${Math.max(v ? 4 : 0, Math.round((v / peak) * 70))}px` }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className='grid grid-cols-6 gap-3.5'>
                {bars.map((m) => (
                  <span key={m} className={`text-center text-[11.5px] ${m === month ? 'font-600 text-ink' : 'text-ink-3'}`}>
                    {monthName(m, true)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className='flex flex-col gap-3.5 px-5 py-[18px] border border-solid border-line rounded-card'>
            <div className='flex items-center gap-2'>
              <span className='flex-1 text-[12.5px] font-500 text-ink-2'>{t('byCategory')}</span>
              {active !== null && (
                <button
                  type='button'
                  aria-label={t('clearFilter', { what: active })}
                  onClick={() => setFilter(null)}
                  className='flex items-center gap-1.5 h-6 px-[9px] rounded-full border border-solid border-accent-line bg-accent-soft text-xs cursor-pointer'
                >
                  {active}
                  <X {...ICON} />
                </button>
              )}
            </div>
            {summary.map((b, bar) => (
              <div key={b.currency} className='flex flex-col gap-3'>
                <div aria-hidden className='flex h-3 rounded-full overflow-hidden gap-0.5'>
                  {b.parts.map((p) => (
                    <div key={p.category ?? ''} style={{ flexGrow: p.share, background: color(bar, p.category), opacity: active === null || active === p.category ? 1 : 0.35 }} className='transition-opacity' />
                  ))}
                </div>
                <div className='grid [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-0.5'>
                  {b.parts.map((p) => {
                    const inner = (
                      <>
                        <span aria-hidden className='shrink-0 w-[9px] h-[9px] rounded-[3px]' style={{ background: color(bar, p.category) }} />
                        <span className='flex-1 min-w-0 truncate text-[13px]'>{p.category ?? t('otherCategory')}</span>
                        <span className='text-[13px] font-500 tabular-nums'>{money(p.total, b.currency)}</span>
                        <span className='w-[34px] text-right font-mono text-[11.5px] text-ink-3'>{Math.round(p.share * 100)}%</span>
                      </>
                    );
                    const row = 'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg border border-solid';
                    return p.category === null ? (
                      <div key='' className={`${row} border-transparent`}>
                        {inner}
                      </div>
                    ) : (
                      <button
                        key={p.category}
                        type='button'
                        aria-pressed={active === p.category}
                        className={`${row} text-left cursor-pointer ${active === p.category ? 'bg-accent-soft border-accent-line' : 'border-transparent bg-transparent hover:bg-hover'}`}
                        onClick={() => setFilter(active === p.category ? null : p.category)}
                      >
                        {inner}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className='flex flex-col gap-4'>
        {[...days].map(([day, rows]) => (
          <section key={day} className='flex flex-col gap-1.5'>
            <div className='flex items-center px-1'>
              <GroupLabel>{dayTitle(day, t)}</GroupLabel>
              <span className='flex-1' />
              <span className='text-[12.5px] text-ink-3 tabular-nums'>{sums(rows).join(' + ')}</span>
            </div>
            <Card>
              {rows.map((r) => {
                const isBusy = busy.includes(r.id);
                const what = r.description || r.category;
                const Icon = ICONS[categoryKeyOf(r.category)] ?? Wallet;
                const bar = Math.max(0, summary.findIndex((b) => b.currency === r.currency));
                const c = slots[bar]?.get(r.category);
                const tone = c ? `var(--cat-${c})` : 'var(--cat-other)';
                return (
                  <div key={r.id} className='list-row'>
                    <span aria-hidden className='grid place-items-center w-[30px] h-[30px] shrink-0 rounded-lg text-[15px]' style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}>
                      <Icon {...ICON} />
                    </span>
                    <div className='row-main flex flex-col'>
                      <button type='button' className='link text-[13.5px] font-400 truncate' disabled={isBusy} onClick={() => setEditing(r)}>
                        {r.description || '—'}
                      </button>
                      <span className='text-xs text-ink-3'>{r.category}</span>
                    </div>
                    <Thumbs ids={r.attachment_ids} />
                    <span className='ml-auto text-sm font-500 tabular-nums whitespace-nowrap'>{money(r.amount, r.currency)}</span>
                    <RowActions editLabel={t('editExpenseLabel', { what })} deleteLabel={t('deleteExpense', { what })} disabled={isBusy} onEdit={() => setEditing(r)} onDelete={() => remove(r.id, 'delete_expenses', `${what}: ${money(r.amount, r.currency)}`)} />
                  </div>
                );
              })}
            </Card>
          </section>
        ))}
      </div>
      {editing !== undefined && <ExpenseForm expense={editing} categories={data.items.map((x) => x.category)} onClose={() => setEditing(undefined)} />}
    </PageBody>
  );
}
