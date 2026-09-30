import type { Namespace, TFunction } from 'i18next';
import { createI18n } from './i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in the machine's local time zone. */
export const toLocalDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'HH:MM' in local time. */
export const toLocalTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 'YYYY-MM-DDTHH:MM' in local time, e.g. a stored UTC instant as the reminder form shows and sends it. */
export const toLocalMinute = (d: Date): string => `${toLocalDate(d)}T${toLocalTime(d)}`;

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

export type DayBucket = 'today' | 'yesterday' | 'week' | 'older';

/** Sidebar group of a conversation's updated_at, in local days (design §2). */
export function dayBucket(iso: string, today: string): DayBucket {
  const day = toLocalDate(new Date(iso));
  if (day === today) return 'today';
  if (day === addDays(today, -1)) return 'yesterday';
  return day >= addDays(today, -7) ? 'week' : 'older';
}

/** 'today' / 'tomorrow' / 'yesterday' for a local date, else null (the caller shows weekday + date). */
export function relativeDay(date: string, today: string): 'today' | 'tomorrow' | 'yesterday' | null {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return date === addDays(today, -1) ? 'yesterday' : null;
}

export const partOfDay = (d: Date): 'morning' | 'afternoon' | 'evening' =>
  d.getHours() >= 5 && d.getHours() < 12 ? 'morning' : d.getHours() >= 12 && d.getHours() < 18 ? 'afternoon' : 'evening';

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

let viT: TFunction<Namespace> | undefined; // created on first use, so importing dates never builds an i18n instance

/** Text of a rule via `t` of any namespace (Vietnamese by default): 'Hằng ngày', 'Hằng tuần: T2, T4', 'Ngày 15 hằng tháng'. Unknown rules come back as-is. */
export function recurrenceText(rule: string, t: TFunction<Namespace> = (viT ??= createI18n('vi').t)): string {
  if (rule === 'daily') return t('common:recurDaily');
  if (rule.startsWith('weekly:')) {
    const days = rule.slice(7).split(',').map((d) => (/^[1-7]$/.test(d) ? t(`common:weekday.${d as '1'}`) : d));
    return t('common:recurWeekly', { days: days.join(', ') });
  }
  if (rule.startsWith('monthly:')) return t('common:recurMonthly', { day: rule.slice(8) });
  return rule;
}

/** A recurrence rule as form fields. weekdays: 1 = Monday … 7 = Sunday. */
export type RecurrenceForm = { kind: 'none' | 'daily' | 'weekly' | 'monthly'; weekdays: number[]; day: number };

export function parseRecurrence(s: string | null): RecurrenceForm {
  const f: RecurrenceForm = { kind: 'none', weekdays: [], day: 1 };
  if (!s || !RECURRENCE_RE.test(s)) return f;
  if (s === 'daily') return { ...f, kind: 'daily' };
  if (s.startsWith('weekly:')) return { ...f, kind: 'weekly', weekdays: s.slice(7).split(',').map(Number) };
  return { ...f, kind: 'monthly', day: Number(s.slice(8)) };
}

/** The rule for RECURRENCE_RE, or null for none (and for weekly without days). */
export function formatRecurrence(f: RecurrenceForm): string | null {
  if (f.kind === 'daily') return 'daily';
  if (f.kind === 'weekly') {
    const days = [...new Set(f.weekdays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
    return days.length ? `weekly:${days.join(',')}` : null;
  }
  if (f.kind === 'monthly') return `monthly:${Math.min(31, Math.max(1, Math.round(f.day) || 1))}`;
  return null;
}
