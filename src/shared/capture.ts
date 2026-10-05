// Quick capture (docs/ui-redesign-design.md): a line typed by the user becomes a task, reminder, expense or note by local
// rules, in Vietnamese and English, with no model involved. Pure: the renderer shows `parseCapture`'s result as a live
// preview and saves it with the ordinary create_* tools, so a capture is a direct action (design D7), not a proposal.

import { addDays, parseLocalDate, toLocalDate, toLocalMinute } from './dates';
import { toMinor } from './money';
import { fold, foldWithMap } from './text';

export const CAPTURE_KINDS = ['task', 'reminder', 'expense', 'note'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export type Capture =
  | { kind: 'task'; title: string; due_date: string; due_time?: string }
  | { kind: 'reminder'; message: string; remind_at: string }
  | { kind: 'expense'; amount: number; currency: string; category: string; description: string; spent_at: string }
  | { kind: 'note'; title: string; body?: string };

/** `amount`: an expense with no amount in it; `past`: a reminder for a time that has already gone. */
export type CaptureResult = { ok: true; capture: Capture } | { ok: false; reason: 'empty' | 'amount' | 'past' };

export type CaptureOptions = {
  now: Date;
  /** The currency a bare "45k" means. */
  currency: string;
  /** Expense categories already in use, so a line that names one lands in it. */
  categories?: string[];
  /** Language of the category names given to a new category. */
  lang?: 'vi' | 'en';
};

// ---- tokens (matched on the accent-folded text) ----

const UNITS: Record<string, number> = { k: 1e3, nghin: 1e3, ngan: 1e3, tr: 1e6, trieu: 1e6, m: 1e6 };
const MONEY_UNIT = '(?:k|nghin|ngan|tr|trieu|d|vnd|usd|eur)(?![a-z])';
// 45k, 1.2tr, 1tr2, 45.000d, 50000 vnd, $12.5, 12 usd. `m` (million) counts only when the user chose "expense".
const MONEY_STRICT = new RegExp(`(?:(\\$|€)\\s*(\\d+(?:[.,]\\d+)*))|(?:(\\d+(?:[.,]\\d+)*)\\s*(${MONEY_UNIT}|€))`, 'gi');
const MONEY_LOOSE = new RegExp(`(?:(\\$|€)\\s*(\\d+(?:[.,]\\d+)*))|(?:(\\d+(?:[.,]\\d+)*)\\s*((?:k|nghin|ngan|tr|trieu|m|d|vnd|usd|eur)(?![a-z])|€))`, 'gi');
const ANY_NUMBER = /\d+(?:[.,]\d+)*/;

const TIME_PATTERNS: [RegExp, (m: RegExpExecArray) => [number, number, string?]][] = [
  [/\b(\d{1,2}):(\d{2})\s*(am|pm)?(?![a-z\d])/g, (m) => [+m[1], +m[2], m[3]]],
  [/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/g, (m) => [+m[1], +(m[2] ?? 0), m[3]]],
  [/\b(\d{1,2})\s?h(?:\s?(\d{2}))?(?![a-z\d])/g, (m) => [+m[1], +(m[2] ?? 0)]],
  [/\b(\d{1,2})\s?gio(?:\s?(\d{2}|ruoi))?(?![a-z])/g, (m) => [+m[1], m[2] === 'ruoi' ? 30 : +(m[2] ?? 0)]],
];
const DAY_PART = /\b(sang|trua|chieu|toi|dem|morning|afternoon|evening|night)\b/;

const WEEKDAYS: [RegExp, number][] = [
  [/\b(?:thu\s?(?:hai|2)|monday)\b/g, 1],
  [/\b(?:thu\s?(?:ba|3)|tuesday)\b/g, 2],
  [/\b(?:thu\s?(?:tu|4)|wednesday)\b/g, 3],
  [/\b(?:thu\s?(?:nam|5)|thursday)\b/g, 4],
  [/\b(?:thu\s?(?:sau|6)|friday)\b/g, 5],
  [/\b(?:thu\s?(?:bay|7)|saturday)\b/g, 6],
  [/\b(?:chu\s?nhat|cn|sunday)\b/g, 0],
];
const REL_DAYS: [RegExp, number][] = [
  [/\b(?:ngay\s?kia|day after tomorrow)\b/g, 2],
  [/\b(?:ngay\s?mai|tomorrow|tmrw|mai)\b/g, 1],
  [/\b(?:hom\s?nay|toi\s?nay|today|tonight)\b/g, 0],
];
const REMINDER_WORDS = /\b(?:remind me to|remind me|reminder|nhac toi|nhac nho|nhac)\b/g;
const SPEND_LEAD = /^(?:spent|spend|paid|pay|chi tieu|chi|tra)\s+/;
const CONNECTOR = /(?:\b(?:vao luc|luc|vao|at|on|by)\s+)$/;

type Span = [from: number, to: number];

const first = (re: RegExp, s: string, skip: Span[] = []): RegExpExecArray | null => {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const a = m.index;
    const b = a + m[0].length;
    if (!skip.some(([x, y]) => a < y && b > x)) return m;
    if (m[0].length === 0) re.lastIndex++;
  }
  return null;
};
const span = (m: RegExpExecArray): Span => [m.index, m.index + m[0].length];

/** "1.234.567" and "1,234" are thousands, "1.5" and "1,5" decimals. */
function number(text: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ''));
  return Number(text.replace(',', '.'));
}

type Money = { value: number; currency: string | null; span: Span };

/** The first money amount in the folded text: its value in major units, the currency when it names one, and where it sits. */
function findMoney(s: string, loose: boolean): Money | null {
  const m = first(loose ? MONEY_LOOSE : MONEY_STRICT, s);
  if (!m) return null;
  const sign = m[1];
  const raw = m[2] ?? m[3];
  const unit = (m[4] ?? '').toLowerCase();
  let to = m.index + m[0].length;
  let value = number(raw);
  let currency: string | null = sign === '$' || unit === 'usd' ? 'USD' : sign === '€' || unit === '€' || unit === 'eur' ? 'EUR' : unit === 'd' || unit === 'vnd' ? 'VND' : null;
  if (UNITS[unit]) {
    value *= UNITS[unit];
    // 1tr2 = 1.2tr, 2k5 = 2.5k: digits stuck to the unit are its decimals.
    const tail = /^\d{1,3}(?![\d])/.exec(s.slice(to));
    if (tail) {
      value += (Number(tail[0]) / 10 ** tail[0].length) * UNITS[unit];
      to += tail[0].length;
    }
  }
  if (currency === 'VND' && value < 1000 && !UNITS[unit]) value *= 1000; // "45d" is not 45 dong
  return { value, currency, span: [m.index, to] };
}

type Clock = { hour: number; minute: number; span: Span };

function findTime(s: string, skip: Span[]): Clock | null {
  for (const [re, read] of TIME_PATTERNS) {
    const m = first(re, s, skip);
    if (!m) continue;
    let [hour, minute, mer] = read(m);
    if (hour > 23 || minute > 59) continue;
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    let [a, b] = span(m);
    if (!mer) {
      // "3h chieu" / "8h toi": a day part right after the time shifts a 12-hour reading to the afternoon or evening.
      const part = DAY_PART.exec(s.slice(b).replace(/^\s+/, ''));
      if (part && part.index === 0) {
        const word = part[1];
        if ((word === 'chieu' || word === 'toi' || word === 'afternoon' || word === 'evening' || word === 'night') && hour < 12) hour += 12;
        if (word === 'trua' && hour < 11) hour += 12;
        const gap = s.slice(b).length - s.slice(b).replace(/^\s+/, '').length;
        b += gap + word.length;
      }
    }
    return { hour, minute, span: [a, b] };
  }
  return null;
}

type Day = { date: string; span: Span; explicit: true };

function findDate(s: string, now: Date, skip: Span[]): Day | null {
  const today = toLocalDate(now);
  for (const [re, n] of REL_DAYS) {
    const m = first(re, s, skip);
    if (m) return { date: addDays(today, n), span: span(m), explicit: true };
  }
  for (const [re, dow] of WEEKDAYS) {
    const m = first(re, s, skip);
    if (!m) continue;
    const ahead = ((dow - parseLocalDate(today).getDay() + 6) % 7) + 1; // the next one, never today
    return { date: addDays(today, ahead), span: span(m), explicit: true };
  }
  const iso = first(/\b(\d{4})-(\d{2})-(\d{2})\b/g, s, skip);
  if (iso) return { date: iso[0], span: span(iso), explicit: true };
  const dm = first(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, s, skip);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : now.getFullYear();
    let d = new Date(year, +dm[2] - 1, +dm[1]);
    if (!dm[3] && toLocalDate(d) < today) d = new Date(year + 1, +dm[2] - 1, +dm[1]);
    if (d.getMonth() === +dm[2] - 1 && d.getDate() === +dm[1]) return { date: toLocalDate(d), span: span(dm), explicit: true };
  }
  const dom = first(/\bngay\s?(\d{1,2})\b/g, s, skip);
  if (dom && +dom[1] >= 1 && +dom[1] <= 31) {
    let d = new Date(now.getFullYear(), now.getMonth(), +dom[1]);
    if (toLocalDate(d) < today) d = new Date(now.getFullYear(), now.getMonth() + 1, +dom[1]);
    if (d.getDate() === +dom[1]) return { date: toLocalDate(d), span: span(dom), explicit: true };
  }
  return null;
}

// ---- kinds ----

const NOTE_PREFIX = /^\s*(?:note|ghi chu)\s*:\s*/;

/** The kind a line most likely is: a "note:" prefix, an amount with a unit, a clock time or a reminder word, else a task. */
export function detectKind(text: string): CaptureKind {
  const { folded } = foldWithMap(text);
  if (NOTE_PREFIX.test(folded)) return 'note';
  if (findMoney(folded, false)) return 'expense';
  REMINDER_WORDS.lastIndex = 0;
  if (REMINDER_WORDS.test(folded) || findTime(folded, [])) return 'reminder';
  return 'task';
}

export const CATEGORY_WORDS: [key: string, words: RegExp][] = [
  ['coffee', /\b(?:ca phe|cafe|coffee|latte|capuchino|cappuccino|tra sua|milk tea|bubble tea|tea)\b/],
  ['transport', /\b(?:grab|taxi|uber|xang|fuel|gas|petrol|bus|xe buyt|gui xe|parking|ve xe|metro|di chuyen|di lai|giao thong|dat xe|toll)\b/],
  ['bills', /\b(?:dien|nuoc|internet|wifi|hoa don|bill|bills|rent|tien nha|nha cua|thue nha|netflix|spotify|dien thoai|phone)\b/],
  ['health', /\b(?:thuoc|kham|benh vien|pharmacy|doctor|dentist|nha khoa|gym|suc khoe|health|medicine)\b/],
  ['fun', /\b(?:phim|cinema|movie|game|karaoke|concert|giai tri|fun|bar|pub|party)\b/],
  ['shopping', /\b(?:mua sam|shopping|shop|ao|quan|giay|uniqlo|shopee|lazada|tiki|amazon|clothes)\b/],
  ['food', /\b(?:pho|bun|com|an|lunch|dinner|breakfast|bua|banh|food|an uong|nha hang|restaurant|pizza|meal|an sang|an trua|an toi)\b/],
];
const CATEGORY_NAMES: Record<'vi' | 'en', Record<string, string>> = {
  vi: { coffee: 'Cà phê', transport: 'Đi lại', bills: 'Hóa đơn', health: 'Sức khỏe', fun: 'Giải trí', shopping: 'Mua sắm', food: 'Ăn uống', other: 'Khác' },
  en: { coffee: 'Coffee', transport: 'Transport', bills: 'Bills', health: 'Health', fun: 'Fun', shopping: 'Shopping', food: 'Food', other: 'Other' },
};

/** Which of the built-in categories a name or a line belongs to, by its words; 'other' when none does. */
export const categoryKeyOf = (text: string): string => CATEGORY_WORDS.find(([, re]) => re.test(fold(text)))?.[0] ?? 'other';

function categoryOf(folded: string, o: CaptureOptions): string {
  const own = (o.categories ?? []).find((c) => c.trim() && new RegExp(`(?:^|[^a-z])${fold(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z]|$)`).test(folded));
  if (own) return own;
  const key = CATEGORY_WORDS.find(([, re]) => re.test(folded))?.[0] ?? 'other';
  return CATEGORY_NAMES[o.lang ?? 'vi'][key];
}

/** The text with the spans cut out (and the connector word before each, e.g. "at" / "lúc"), tidied and capitalised. */
function rest(original: { text: string; folded: string; at: number[] }, spans: Span[]): string {
  const ranges: Span[] = [];
  for (const [from, to] of spans) {
    let a = from;
    const c = CONNECTOR.exec(original.folded.slice(0, a));
    if (c) a -= c[0].length;
    if (to > a) ranges.push([original.at[a], original.at[to - 1] + 1]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let out = '';
  let kept = 0;
  for (const [a, b] of ranges) {
    if (a > kept) out += original.text.slice(kept, a);
    kept = Math.max(kept, b);
  }
  out = (out + original.text.slice(kept)).replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, '');
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

/** Spans of the reminder / spending lead words ("remind me to", "nhắc", "chi"), to be dropped from the title. */
function leadSpans(folded: string, kind: CaptureKind): Span[] {
  const out: Span[] = [];
  if (kind === 'reminder' || kind === 'task') {
    REMINDER_WORDS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REMINDER_WORDS.exec(folded))) out.push(span(m));
  }
  if (kind === 'expense') {
    const m = SPEND_LEAD.exec(folded.trimStart());
    if (m) {
      const off = folded.length - folded.trimStart().length;
      out.push([off, off + m[0].length]);
    }
  }
  return out;
}

export function parseCapture(input: string, kind: CaptureKind, o: CaptureOptions): CaptureResult {
  const original = foldWithMap(input.trim());
  const { text, folded } = original;
  if (!text) return { ok: false, reason: 'empty' };
  const today = toLocalDate(o.now);

  if (kind === 'note') {
    const body = text.replace(/^\s*(?:note|ghi chú|ghi chu)\s*:\s*/i, '').trim();
    if (!body) return { ok: false, reason: 'empty' };
    const lines = body.split('\n');
    const tail = [lines[0].slice(80), ...lines.slice(1)].join('\n').trim();
    return { ok: true, capture: { kind: 'note', title: lines[0].slice(0, 80), ...(tail ? { body: tail } : {}) } };
  }

  if (kind === 'expense') {
    const money = findMoney(folded, true);
    let value: number;
    let currency: string | null;
    let spans: Span[] = [];
    if (money) {
      ({ value, currency } = money);
      spans = [money.span];
    } else {
      const m = first(new RegExp(ANY_NUMBER.source, 'g'), folded);
      if (!m) return { ok: false, reason: 'amount' };
      value = number(m[0]);
      if (value < 1000 && (o.currency === 'VND' || o.currency === 'vnd')) value *= 1000;
      currency = null;
      spans = [span(m)];
    }
    const cur = currency ?? o.currency;
    const amount = toMinor(value, cur);
    if (!(amount > 0)) return { ok: false, reason: 'amount' };
    const day = findDate(folded, o.now, spans);
    if (day) spans.push(day.span);
    spans.push(...leadSpans(folded, 'expense'));
    const description = rest(original, spans) || cap(text);
    return {
      ok: true,
      capture: { kind: 'expense', amount, currency: cur, category: categoryOf(folded, o), description, spent_at: day?.date ?? today },
    };
  }

  const spans: Span[] = [];
  const day = findDate(folded, o.now, spans);
  if (day) spans.push(day.span);
  const clock = findTime(folded, spans);
  if (clock) spans.push(clock.span);
  spans.push(...leadSpans(folded, kind));
  const title = rest(original, spans) || cap(text);

  if (kind === 'task') {
    return { ok: true, capture: { kind: 'task', title, due_date: day?.date ?? today, ...(clock ? { due_time: hhmm(clock) } : {}) } };
  }

  // A reminder with no day is for today while that time is still ahead, else tomorrow.
  const hour = clock?.hour ?? 9;
  const minute = clock?.minute ?? 0;
  let date = day?.date ?? today;
  const at = (d: string) => new Date(parseLocalDate(d).getFullYear(), parseLocalDate(d).getMonth(), parseLocalDate(d).getDate(), hour, minute);
  if (at(date).getTime() <= o.now.getTime()) {
    if (day) return { ok: false, reason: 'past' };
    date = addDays(date, 1);
  }
  return { ok: true, capture: { kind: 'reminder', message: title, remind_at: toLocalMinute(at(date)) } };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const hhmm = ({ hour, minute }: Clock): string => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** The create_* tool and its arguments for a capture, as api.data.save takes them. */
export function captureToolCall(c: Capture): { tool: string; args: Record<string, unknown> } {
  switch (c.kind) {
    case 'task':
      return { tool: 'create_task', args: { title: c.title, due_date: c.due_date, ...(c.due_time ? { due_time: c.due_time } : {}) } };
    case 'reminder':
      return { tool: 'create_reminder', args: { message: c.message, remind_at: c.remind_at } };
    case 'expense':
      return { tool: 'create_expense', args: { amount: c.amount, currency: c.currency, category: c.category, description: c.description, spent_at: c.spent_at } };
    case 'note':
      return { tool: 'create_note', args: { kind: 'note', title: c.title, body: c.body || c.title } };
  }
}

/** The delete_* tool that undoes a capture's create_* tool. */
export const UNDO_TOOL: Record<string, string> = {
  create_task: 'delete_tasks',
  create_reminder: 'delete_reminders',
  create_expense: 'delete_expenses',
  create_note: 'delete_notes',
};
