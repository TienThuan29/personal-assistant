import type { TFunction } from 'i18next';
import { createI18n } from './i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in the machine's local time zone. */
export const toLocalDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'HH:MM' in local time. */
export const toLocalTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Local midnight of a 'YYYY-MM-DD' (new Date('YYYY-MM-DD') would be UTC). */
export const parseLocalDate = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (date: string, n: number): string => {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
};

/** UTC ISO bounds [start, end) of a local day, to compare with stored *_at timestamps. */
export const localDayRange = (date: string): { start: string; end: string } => ({
  start: parseLocalDate(date).toISOString(),
  end: parseLocalDate(addDays(date, 1)).toISOString(),
});

export const RECURRENCE_RE = /^(daily|weekly:[1-7](,[1-7])*|monthly:([1-9]|[12]\d|3[01]))$/;

/** Next due date after `from`. weekly days: 1 = Monday … 7 = Sunday. */
export function nextOccurrence(recurrence: string, from: string): string {
  if (!RECURRENCE_RE.test(recurrence)) throw new Error(`Recurrence không hợp lệ: ${recurrence}`);
  if (recurrence === 'daily') return addDays(from, 1);
  if (recurrence.startsWith('weekly:')) {
    const days = recurrence.slice(7).split(',').map(Number);
    for (let i = 1; i <= 7; i++) {
      const candidate = addDays(from, i);
      if (days.includes(parseLocalDate(candidate).getDay() || 7)) return candidate;
    }
  }
  if (recurrence.startsWith('monthly:')) {
    const day = Number(recurrence.slice(8));
    const d = parseLocalDate(from);
    const [y, m] = [d.getFullYear(), d.getMonth()];
    // The rule's day, clamped to the length of month m (m may be 12: next January).
    const clamped = (month: number): number => Math.min(day, new Date(y, month + 1, 0).getDate());
    if (clamped(m) > d.getDate()) return toLocalDate(new Date(y, m, clamped(m)));
    return toLocalDate(new Date(y, m + 1, clamped(m + 1)));
  }
  throw new Error(`Recurrence không hợp lệ: ${recurrence}`);
}

let viT: TFunction | undefined; // created on first use, so importing dates never builds an i18n instance

/** Text of a rule via `t` (Vietnamese by default): 'Hằng ngày', 'Hằng tuần: T2, T4', 'Ngày 15 hằng tháng'. Unknown rules come back as-is. */
export function recurrenceText(rule: string, t: TFunction = (viT ??= createI18n('vi').t)): string {
  if (rule === 'daily') return t('recurDaily');
  if (rule.startsWith('weekly:')) {
    const days = rule.slice(7).split(',').map((d) => (/^[1-7]$/.test(d) ? t(`weekday.${d as '1'}`) : d));
    return t('recurWeekly', { days: days.join(', ') });
  }
  if (rule.startsWith('monthly:')) return t('recurMonthly', { day: rule.slice(8) });
  return rule;
}
