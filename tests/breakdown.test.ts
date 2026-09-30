import { breakdown } from '../src/shared/money';

describe('breakdown', () => {
  // Out of order on purpose, so the sorts are what put them in order.
  const vnd = [30, 80, 10, 60, 50, 20, 70, 40].map((k) => ({ category: `c${k}`, currency: 'VND', amount: k * 1000 }));
  const items = [{ category: 'travel', currency: 'USD', amount: 1299 }, ...vnd, { category: 'c80', currency: 'VND', amount: 5000 }];

  it('groups per currency, largest first', () => {
    expect(breakdown(items).map((b) => [b.currency, b.total])).toEqual([
      ['VND', 365000],
      ['USD', 1299],
    ]);
  });

  it('keeps the top 6 categories, descending, and folds the rest into other', () => {
    const [b] = breakdown(items);
    expect(b.parts.map((p) => p.category)).toEqual(['c80', 'c70', 'c60', 'c50', 'c40', 'c30', null]);
    expect(b.parts[0].total).toBe(85000);
    expect(b.parts[6].total).toBe(30000);
  });

  it('has no other part with 6 categories or fewer', () => {
    expect(breakdown(items)[1].parts.map((p) => p.category)).toEqual(['travel']);
    expect(breakdown(vnd.slice(0, 6)).at(0)?.parts.some((p) => p.category === null)).toBe(false);
  });

  it('shares sum to 1', () => {
    for (const b of breakdown(items)) expect(Math.abs(b.parts.reduce((s, p) => s + p.share, 0) - 1)).toBeLessThan(1e-9);
  });

  it('is empty for no items', () => {
    expect(breakdown([])).toEqual([]);
  });
});
