import { addDays, localDayRange, nextOccurrence, recurrenceText, toLocalDate } from '../src/shared/dates';
import { createI18n } from '../src/shared/i18n';
import { formatMoney } from '../src/shared/money';

describe('dates', () => {
  it('toLocalDate uses local time', () => {
    expect(toLocalDate(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
  });
  it('addDays crosses months', () => expect(addDays('2026-01-31', 1)).toBe('2026-02-01'));
  it('daily', () => expect(nextOccurrence('daily', '2026-09-28')).toBe('2026-09-29'));
  it('weekly picks the next listed weekday (2026-09-28 is a Monday)', () => {
    expect(nextOccurrence('weekly:1,3', '2026-09-28')).toBe('2026-09-30');
    expect(nextOccurrence('weekly:1', '2026-09-28')).toBe('2026-10-05');
    expect(nextOccurrence('weekly:7', '2026-09-28')).toBe('2026-10-04');
    expect(nextOccurrence('weekly:5', '2026-12-30')).toBe('2027-01-01');
  });
  it('monthly clamps to the month length and wraps the year', () => {
    expect(nextOccurrence('monthly:31', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence('monthly:31', '2028-01-31')).toBe('2028-02-29');
    expect(nextOccurrence('monthly:15', '2026-12-15')).toBe('2027-01-15');
  });
  it('monthly stays in the same month when the day is still ahead', () => {
    expect(nextOccurrence('monthly:15', '2026-09-10')).toBe('2026-09-15');
  });
  it('localDayRange spans one local day', () => {
    const r = localDayRange('2026-09-28');
    expect(r.start).toBe(new Date(2026, 8, 28).toISOString());
    expect(Date.parse(r.end) - Date.parse(r.start)).toBe(86_400_000);
  });
  it('rejects unknown rules', () => {
    expect(() => nextOccurrence('yearly', '2026-09-28')).toThrow();
    expect(() => nextOccurrence('monthly:0', '2026-01-31')).toThrow();
  });
  it('recurrenceText reads rules in Vietnamese', () => {
    expect(recurrenceText('daily')).toBe('Hằng ngày');
    expect(recurrenceText('weekly:1,3,7')).toBe('Hằng tuần: T2, T4, CN');
    expect(recurrenceText('monthly:15')).toBe('Ngày 15 hằng tháng');
  });
  it('recurrenceText reads rules in English with an English t', () => {
    const { t } = createI18n('en');
    expect(recurrenceText('daily', t)).toBe('Daily');
    expect(recurrenceText('weekly:1,3,7', t)).toBe('Weekly: Mon, Wed, Sun');
    expect(recurrenceText('monthly:15', t)).toBe('Day 15 of every month');
    expect(recurrenceText('yearly', t)).toBe('yearly');
  });
});

describe('money', () => {
  it('formats minor units', () => {
    expect(formatMoney(50_000, 'VND')).toContain('50.000');
    expect(formatMoney(1250, 'USD')).toContain('12,50');
  });
  it('formats in the vi or intl style', () => {
    const nb = (s: string) => s.replace(/\s/g, ' '); // Intl uses non-breaking spaces
    expect(nb(formatMoney(55_000, 'VND', 'vi'))).toBe('55.000 ₫');
    expect(formatMoney(55_000, 'VND', 'intl')).toBe('₫55,000');
    expect(formatMoney(1250, 'USD', 'intl')).toBe('$12.50');
  });
  it('falls back for malformed codes', () => expect(formatMoney(5, 'XXXX')).toBe('5 XXXX'));
  it('formats a well-formed but unknown code with 2 decimals', () =>
    expect(formatMoney(5, 'XYZ', 'intl')).toBe('XYZ 0.05'));
});
