import { captureToolCall, detectKind, parseCapture, UNDO_TOOL } from '../src/shared/capture';
import { foldWithMap } from '../src/shared/text';

// Sunday 4 October 2026, 10:00 local.
const now = new Date(2026, 9, 4, 10, 0);
const opts = { now, currency: 'VND', lang: 'en' as const };
const vi = { ...opts, lang: 'vi' as const };
const ok = (text: string, kind: Parameters<typeof parseCapture>[1], o: Parameters<typeof parseCapture>[2] = opts) => {
  const r = parseCapture(text, kind, o);
  if (!r.ok) throw new Error(`${text}: ${r.reason}`);
  return r.capture;
};

describe('detectKind', () => {
  it.each([
    ['note: ý tưởng cho meetup', 'note'],
    ['Ghi chú: mua quà', 'note'],
    ['coffee 45k', 'expense'],
    ['Cà phê muối 45.000đ', 'expense'],
    ['ăn phở 55k', 'expense'],
    ['lunch $12.5', 'expense'],
    ['call Lan 3pm', 'reminder'],
    ['họp 9h30 mai', 'reminder'],
    ['nhắc tôi gọi mẹ', 'reminder'],
    ['remind me to water the plants', 'reminder'],
    ['buy milk', 'task'],
    ['gửi báo cáo thứ sáu', 'task'],
    ['walk 5km', 'task'], // "km" is not a money unit
    ['read 3 chapters', 'task'],
  ])('%s → %s', (text, kind) => expect(detectKind(text)).toBe(kind));
});

describe('expense', () => {
  it('reads k, tr, thousands separators and the decimals stuck to a unit', () => {
    expect(ok('coffee 45k', 'expense')).toMatchObject({ amount: 45000, currency: 'VND', category: 'Coffee', description: 'Coffee' });
    expect(ok('quần áo 1.2tr', 'expense', vi)).toMatchObject({ amount: 1_200_000 });
    expect(ok('quần áo 1tr2', 'expense', vi)).toMatchObject({ amount: 1_200_000 });
    expect(ok('trà 2k5', 'expense', vi)).toMatchObject({ amount: 2500 });
    expect(ok('Grab 68.000đ', 'expense')).toMatchObject({ amount: 68000, category: 'Transport' });
    expect(ok('tiền điện 1.234.567 vnd', 'expense', vi)).toMatchObject({ amount: 1_234_567, category: 'Hóa đơn' });
  });

  it('names a currency when the line does, in minor units', () => {
    expect(ok('lunch $12.5', 'expense')).toMatchObject({ amount: 1250, currency: 'USD', category: 'Food' });
    expect(ok('book 20 usd', 'expense')).toMatchObject({ amount: 2000, currency: 'USD' });
    expect(ok('coffee 3', 'expense', { ...opts, currency: 'USD' })).toMatchObject({ amount: 300, currency: 'USD' });
  });

  it('takes a bare small number as thousands of dong, and needs some amount', () => {
    expect(ok('phở 55', 'expense', vi)).toMatchObject({ amount: 55000, category: 'Ăn uống' });
    expect(parseCapture('coffee', 'expense', opts)).toEqual({ ok: false, reason: 'amount' });
  });

  it('strips the lead word and the date, and dates the expense', () => {
    expect(ok('chi 45k cà phê muối', 'expense', vi)).toMatchObject({ description: 'Cà phê muối', spent_at: '2026-10-04' });
    expect(ok('spent 120k on gym yesterday-ish tomorrow', 'expense')).toMatchObject({ spent_at: '2026-10-05' });
  });

  it('reuses a category the user already has, whatever the accents', () => {
    expect(ok('an uong 80k', 'expense', { ...vi, categories: ['Ăn uống', 'Đi lại'] })).toMatchObject({ category: 'Ăn uống' });
  });
});

describe('reminder', () => {
  it('is for today while the time is ahead, else tomorrow', () => {
    expect(ok('remind me to call Lan 3pm', 'reminder')).toEqual({ kind: 'reminder', message: 'Call Lan', remind_at: '2026-10-04T15:00' });
    expect(ok('call Lan 9am', 'reminder')).toEqual({ kind: 'reminder', message: 'Call Lan', remind_at: '2026-10-05T09:00' });
    expect(ok('nhắc đi khám', 'reminder', vi)).toEqual({ kind: 'reminder', message: 'Đi khám', remind_at: '2026-10-05T09:00' });
  });

  it('reads Vietnamese days and clock words', () => {
    expect(ok('họp 9h30 mai', 'reminder', vi)).toEqual({ kind: 'reminder', message: 'Họp', remind_at: '2026-10-05T09:30' });
    expect(ok('nhắc tôi nộp báo cáo 8h tối thứ sáu', 'reminder', vi)).toEqual({ kind: 'reminder', message: 'Nộp báo cáo', remind_at: '2026-10-09T20:00' });
    expect(ok('nhac toi goi me 3h chieu ngay mai', 'reminder', vi)).toMatchObject({ message: 'Goi me', remind_at: '2026-10-05T15:00' });
    expect(ok('đi chợ lúc 7 giờ rưỡi ngày kia', 'reminder', vi)).toEqual({ kind: 'reminder', message: 'Đi chợ', remind_at: '2026-10-06T07:30' });
    expect(ok('meeting 15:30 tomorrow', 'reminder')).toMatchObject({ message: 'Meeting', remind_at: '2026-10-05T15:30' });
    expect(ok('dentist on 12/10 at 4pm', 'reminder')).toEqual({ kind: 'reminder', message: 'Dentist', remind_at: '2026-10-12T16:00' });
  });

  it('refuses a time that has gone today', () => {
    expect(parseCapture('remind me today 8am', 'reminder', opts)).toEqual({ ok: false, reason: 'past' });
  });
});

describe('task', () => {
  it('is due today unless a day is named, and keeps a clock time', () => {
    expect(ok('buy milk', 'task')).toEqual({ kind: 'task', title: 'Buy milk', due_date: '2026-10-04' });
    expect(ok('send report friday', 'task')).toEqual({ kind: 'task', title: 'Send report', due_date: '2026-10-09' });
    expect(ok('call Minh 14h', 'task')).toEqual({ kind: 'task', title: 'Call Minh', due_date: '2026-10-04', due_time: '14:00' });
    expect(ok('gửi báo cáo thứ hai', 'task', vi)).toMatchObject({ title: 'Gửi báo cáo', due_date: '2026-10-05' });
  });

  it('a weekday is the next one, never today', () => {
    expect(ok('review chủ nhật', 'task', vi)).toMatchObject({ due_date: '2026-10-11' });
  });
});

describe('note and edge cases', () => {
  it('splits a long or multi-line note into title and body', () => {
    expect(ok('note: Ý tưởng\nchi tiết một', 'note')).toEqual({ kind: 'note', title: 'Ý tưởng', body: 'chi tiết một' });
    expect(ok('just a thought', 'note')).toEqual({ kind: 'note', title: 'just a thought' });
    const long = ok(`note: ${'x'.repeat(100)}`, 'note');
    expect(long).toMatchObject({ kind: 'note', title: 'x'.repeat(80), body: 'x'.repeat(20) });
  });

  it('is empty for blank input and falls back to the whole text when nothing is left of it', () => {
    expect(parseCapture('   ', 'task', opts)).toEqual({ ok: false, reason: 'empty' });
    expect(parseCapture('note:  ', 'note', opts)).toEqual({ ok: false, reason: 'empty' });
    expect(ok('tomorrow', 'task')).toMatchObject({ title: 'Tomorrow', due_date: '2026-10-05' });
  });

  it('keeps accents of what it keeps, whichever way the line was typed', () => {
    expect(ok('Gọi Minh về địa điểm 9h', 'reminder', vi)).toMatchObject({ message: 'Gọi Minh về địa điểm' });
    expect(foldWithMap('Đà Lạt').folded).toBe('da lat');
  });
});

describe('captureToolCall', () => {
  it('maps every kind to its create tool, and each has an undo', () => {
    const calls = [
      captureToolCall(ok('buy milk', 'task')),
      captureToolCall(ok('call Lan 3pm', 'reminder')),
      captureToolCall(ok('coffee 45k', 'expense')),
      captureToolCall(ok('note: hi', 'note')),
    ];
    expect(calls.map((c) => c.tool)).toEqual(['create_task', 'create_reminder', 'create_expense', 'create_note']);
    expect(calls[2].args).toEqual({ amount: 45000, currency: 'VND', category: 'Coffee', description: 'Coffee', spent_at: '2026-10-04' });
    expect(calls[3].args).toEqual({ kind: 'note', title: 'hi', body: 'hi' });
    for (const c of calls) expect(UNDO_TOOL[c.tool]).toMatch(/^delete_/);
  });
});
