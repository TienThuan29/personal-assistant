import { breakdown } from '../src/shared/money';

describe('breakdown', () => {
  const vnd = [80, 70, 60, 50, 40, 30, 20, 10].map((amount, i) => ({ category: `c${i}`, currency: 'VND', amount: amount * 1000 }));
  const items = [...vnd, { category: 'c0', currency: 'VND', amount: 5000 }, { category: 'travel', currency: 'USD', amount: 1299 }];

  it('groups per currency, largest first', () => {
    expect(breakdown(items).map((b) => [b.currency, b.total])).toEqual([
      ['VND', 365000],
      ['USD', 1299],
    ]);
  });

  it('keeps the top 6 categories, descending, and folds the rest into other', () => {
    const [b] = breakdown(items);
    expect(b.parts.map((p) => p.category)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', null]);
    expect(b.parts[0].total).toBe(85000);
    expect(b.parts[6].total).toBe(30000);
    const totals = b.parts.slice(0, 6).map((p) => p.total);
    expect(totals).toEqual([...totals].sort((x, y) => y - x));
  });

  it('shares sum to 1', () => {
    for (const b of breakdown(items)) expect(Math.abs(b.parts.reduce((s, p) => s + p.share, 0) - 1)).toBeLessThan(1e-9);
  });

  it('is empty for no items', () => {
    expect(breakdown([])).toEqual([]);
  });
});
