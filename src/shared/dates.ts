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
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
    return toLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, lastDay)));
  }
  throw new Error(`Recurrence không hợp lệ: ${recurrence}`);
}
