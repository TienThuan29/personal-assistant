/** Decimal places of the currency's minor unit (VND 0, USD 2); 0 for an invalid code. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 0;
  } catch {
    return 0;
  }
}

/** 12.5 USD → 1250 (cents). */
export const toMinor = (major: number, currency: string): number => Math.round(major * 10 ** minorDigits(currency));
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
