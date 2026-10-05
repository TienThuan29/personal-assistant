import { fold } from './text';

/**
 * The ⌘K list: items whose label contains the query, ignoring case and accents. Those that start with it come first, then
 * those with a word that does, then the rest; each keeps its own order. An empty query keeps everything.
 */
export function filterPalette<T extends { label: string }>(items: T[], query: string, limit = 7): T[] {
  const q = fold(query.trim());
  if (!q) return items.slice(0, limit);
  const ranked: [number, T][] = [];
  for (const item of items) {
    const f = fold(item.label);
    const at = f.indexOf(q);
    if (at < 0) continue;
    ranked.push([at === 0 ? 0 : f[at - 1] === ' ' ? 1 : 2, item]);
  }
  return ranked
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r[0] - b.r[0] || a.i - b.i)
    .slice(0, limit)
    .map(({ r }) => r[1]);
}
