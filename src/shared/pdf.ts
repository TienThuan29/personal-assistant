/** Pages per batch: matches the 10 images a message may carry. */
export const BATCH = 10;
export const MAX_PDF_PAGES = 100;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** 1-based inclusive page ranges of each batch, e.g. 25 pages → 1–10, 11–20, 21–25. */
export const batchRanges = (total: number): { from: number; to: number }[] =>
  Array.from({ length: Math.ceil(total / BATCH) }, (_, i) => ({ from: i * BATCH + 1, to: Math.min((i + 1) * BATCH, total) }));
