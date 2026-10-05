import { filterPalette } from '../src/shared/palette';

const items = ['Weekend plan', 'Plan October budget', 'Đà Lạt trip budget', 'Replan the trip', 'Dentist'].map((label) => ({ label }));
const labels = (q: string, limit?: number) => filterPalette(items, q, limit).map((i) => i.label);

describe('filterPalette', () => {
  it('keeps everything, up to the limit, for an empty query', () => {
    expect(labels('')).toHaveLength(5);
    expect(labels('  ', 2)).toEqual(['Weekend plan', 'Plan October budget']);
  });

  it('ranks a label that starts with the query, then a word that does, then the rest, keeping order within each', () => {
    expect(labels('plan')).toEqual(['Plan October budget', 'Weekend plan', 'Replan the trip']);
  });

  it('ignores case and accents, đ included', () => {
    expect(labels('DA LAT')).toEqual(['Đà Lạt trip budget']);
    expect(labels('trip')).toEqual(['Đà Lạt trip budget', 'Replan the trip']);
  });

  it('is empty when nothing matches and honours the limit', () => {
    expect(labels('zzz')).toEqual([]);
    expect(labels('e', 2)).toHaveLength(2);
  });
});
