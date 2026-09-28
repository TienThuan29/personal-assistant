/** Amounts are stored in the currency's minor unit (VND: đồng, USD: cent). */
export function formatMoney(amount: number, currency: string): string {
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 0;
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency }).format(amount / 10 ** digits);
  } catch {
    return `${amount} ${currency}`;
  }
}
