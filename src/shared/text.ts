/** Lowercase without Vietnamese accents, for accent-insensitive search and matching. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

/**
 * `fold` of `text` plus, for every character of the result, its index in `text` (NFC): a match found in the folded string
 * can be cut out of the original. Folding never adds characters, so the map is one to one.
 */
export function foldWithMap(text: string): { text: string; folded: string; at: number[] } {
  const nfc = text.normalize('NFC');
  let folded = '';
  const at: number[] = [];
  for (let i = 0; i < nfc.length; i++) {
    const f = fold(nfc[i]);
    folded += f;
    for (let k = 0; k < f.length; k++) at.push(i);
  }
  return { text: nfc, folded, at };
}
