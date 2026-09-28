/** Amounts are stored in the currency's minor unit (VND: đồng, USD: cent). */
export function formatMoney(amount: number, currency: string): string {
  try {
    const fmt = new Intl.NumberFormat('vi-VN', { style: 'currency', currency });
    return fmt.format(amount / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 0));
  } catch {
    return `${amount} ${currency}`;
  }
}
