/** Decimal places of the currency's minor unit (VND 0, USD 2); 0 for an invalid code. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 0;
  } catch {
    return 0;
  }
}

/** 12.5 USD → 1250 (cents). Shifts the decimal exponent instead of multiplying, so 1.005 USD → 101 (1.005 * 100 is 100.49…). */
export const toMinor = (major: number, currency: string): number => {
  const [m, e = '0'] = String(major).split('e'); // String() may already use exponent notation (1e-7, 1e21)
  return Math.round(Number(`${m}e${Number(e) + minorDigits(currency)}`));
};
export const fromMinor = (minor: number, currency: string): number => minor / 10 ** minorDigits(currency);

/** Amounts are stored in the currency's minor unit (VND: đồng, USD: cent). style 'vi': "55.000 ₫", 'intl': "₫55,000". */
export function formatMoney(amount: number, currency: string, style: 'vi' | 'intl' = 'vi'): string {
  try {
    const fmt = new Intl.NumberFormat(style === 'intl' ? 'en-US' : 'vi-VN', { style: 'currency', currency });
    return fmt.format(amount / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 0));
  } catch {
    return `${amount} ${currency}`;
  }
}

export type Breakdown = { currency: string; total: number; parts: { category: string | null; total: number; share: number }[] };

/** Per currency, largest first; categories past `top` fold into one part with category null ("Other"). */
export function breakdown(items: { category: string; currency: string; amount: number }[], top = 6): Breakdown[] {
  const byCur = new Map<string, Map<string, number>>();
  for (const e of items) {
    const m = byCur.get(e.currency) ?? new Map<string, number>();
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    byCur.set(e.currency, m);
  }
  return (
    [...byCur]
      .map(([currency, m]) => {
        const sorted = [...m].sort((a, b) => b[1] - a[1]);
        const total = sorted.reduce((s, [, v]) => s + v, 0);
        const rest = sorted.slice(top).reduce((s, [, v]) => s + v, 0);
        const parts: Breakdown['parts'] = sorted.slice(0, top).map(([category, v]) => ({ category, total: v, share: v / total }));
        if (rest) parts.push({ category: null, total: rest, share: rest / total });
        return { currency, total, parts };
      })
      // ponytail: compares minor units across currencies (a presentation order, not a conversion); put the UI settings'
      // default currency first if it ever matters.
      .sort((a, b) => b.total - a.total)
  );
}
