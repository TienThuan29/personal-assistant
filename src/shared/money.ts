/** Amounts are stored in the currency's minor unit (VND: đồng, USD: cent). style 'vi': "55.000 ₫", 'intl': "₫55,000". */
export function formatMoney(amount: number, currency: string, style: 'vi' | 'intl' = 'vi'): string {
  try {
    const fmt = new Intl.NumberFormat(style === 'intl' ? 'en-US' : 'vi-VN', { style: 'currency', currency });
    return fmt.format(amount / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 0));
  } catch {
    return `${amount} ${currency}`;
  }
}
