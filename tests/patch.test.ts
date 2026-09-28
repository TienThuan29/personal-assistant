import { formatRecurrence, parseRecurrence, RECURRENCE_RE } from '../src/shared/dates';
import { formatMoney, fromMinor, minorDigits, toMinor } from '../src/shared/money';
import { diffPatch } from '../src/shared/patch';

describe('diffPatch', () => {
  it('keeps changed fields only, with cleared ones as null', () => {
    const before = { title: 'a', notes: 'n', due_date: null, priority: 2 };
    expect(diffPatch(before, { title: 'a', notes: '', due_date: '', priority: 1 })).toEqual({ notes: null, priority: 1 });
    expect(diffPatch(before, { title: 'b', due_date: undefined, extra: undefined })).toEqual({ title: 'b' });
    expect(diffPatch(before, { title: 'a' })).toEqual({});
  });
});

describe('money units', () => {
  it('converts between major and minor units', () => {
    expect(toMinor(55000, 'VND')).toBe(55000);
    expect(fromMinor(55000, 'VND')).toBe(55000);
    expect(toMinor(12.5, 'USD')).toBe(1250);
    expect(fromMinor(1250, 'USD')).toBe(12.5);
    expect(toMinor(0.29, 'USD')).toBe(29); // 0.29 * 100 is 28.999…
    expect(toMinor(1200, 'JPY')).toBe(1200);
    expect(toMinor(12.345, 'KWD')).toBe(12345); // 3 digits
    expect(toMinor(12.345, 'USD')).toBe(1235); // 12.345 * 100 is 1234.49…
    expect(toMinor(1.005, 'USD')).toBe(101);
    expect(toMinor(1e-7, 'USD')).toBe(0);
    expect(fromMinor(1200, 'JPY')).toBe(1200);
    expect(minorDigits('XXXX')).toBe(0);
    expect(formatMoney(1250, 'USD', 'intl')).toBe('$12.50');
  });
});

describe('recurrence form', () => {
  it('round-trips rules', () => {
    for (const r of ['daily', 'weekly:1,3,5', 'weekly:7', 'monthly:15', 'monthly:31']) expect(formatRecurrence(parseRecurrence(r))).toBe(r);
    expect(parseRecurrence('weekly:2,4')).toEqual({ kind: 'weekly', weekdays: [2, 4], day: 1 });
    expect(parseRecurrence('monthly:15')).toEqual({ kind: 'monthly', weekdays: [], day: 15 });
  });

  it('maps none, invalid rules and empty choices to null', () => {
    expect(parseRecurrence(null)).toEqual({ kind: 'none', weekdays: [], day: 1 });
    expect(parseRecurrence('yearly').kind).toBe('none');
    expect(formatRecurrence({ kind: 'none', weekdays: [1], day: 5 })).toBeNull();
    expect(formatRecurrence({ kind: 'weekly', weekdays: [], day: 1 })).toBeNull();
  });

  it('sorts weekdays and clamps the day', () => {
    expect(formatRecurrence({ kind: 'weekly', weekdays: [5, 1, 5], day: 1 })).toBe('weekly:1,5');
    expect(formatRecurrence({ kind: 'monthly', weekdays: [], day: 40 })).toBe('monthly:31');
    expect(formatRecurrence({ kind: 'monthly', weekdays: [], day: 0 })).toBe('monthly:1');
    expect(RECURRENCE_RE.test(formatRecurrence({ kind: 'monthly', weekdays: [], day: 0 })!)).toBe(true);
  });
});
