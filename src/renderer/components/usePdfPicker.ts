import { useEffect, useRef, useState } from 'react';
import type { PdfInput } from '../../shared/types';
import { openPdf, PdfProblem } from '../pdf/render';

/** `bytes` fill up page by page; `ready` once every page is drawn. */
export type PickedPdf = { name: string; size: number; pages: number; done: number; bytes: Uint8Array[]; ready: boolean };

export const isPdf = (f: File): boolean => f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name));

/**
 * One picked PDF, drawn to page images in the background as soon as it is picked, so it is usually ready by the time the user
 * sends. `onProblem` gets a refused file (too big, too many pages, password, damaged).
 */
export function usePdfPicker(onProblem: (p: PdfProblem) => void) {
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const run = useRef(0); // a newer pick or a clear cancels the older drawing
  useEffect(
    () => () => {
      run.current++;
    },
    []
  );

  const pick = async (file: File): Promise<void> => {
    const mine = ++run.current;
    setPdf({ name: file.name, size: file.size, pages: 0, done: 0, bytes: [], ready: false });
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      doc = await openPdf(file);
      if (run.current !== mine) return;
      const total = doc.pages;
      setPdf((p) => p && { ...p, pages: total });
      const bytes: Uint8Array[] = [];
      for (let n = 1; n <= total; n++) {
        bytes.push(await doc.renderPage(n)); // oxlint-disable-line no-await-in-loop -- one page at a time keeps memory and the UI in check
        if (run.current !== mine) return;
        setPdf((p) => p && { ...p, done: n });
        await new Promise((r) => setTimeout(r)); // oxlint-disable-line no-await-in-loop -- let the UI paint between pages
      }
      setPdf((p) => p && { ...p, bytes, ready: true });
    } catch (e) {
      if (run.current !== mine) return;
      setPdf(null);
      onProblem(e instanceof PdfProblem ? e : new PdfProblem('pdfInvalid'));
    } finally {
      void doc?.destroy();
    }
  };

  const clear = () => {
    run.current++;
    setPdf(null);
  };
  const toInput = (): PdfInput | null =>
    pdf?.ready ? { name: pdf.name, pages: pdf.bytes.map((bytes, i) => ({ name: `page-${i + 1}.jpg`, bytes })) } : null;

  return { pdf, pick, clear, toInput };
}
