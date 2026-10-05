// Turns a PDF into one JPEG per page, in the renderer (docs/pdf-batch-reasoning-design.md P4).
// The legacy build: the main one needs `Uint8Array.prototype.toHex`, which Electron 37's Chromium (138) does not have yet.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '../../shared/pdf';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Longest side of a page image: the same cap main puts on every image it sends (MAX_SIDE in ipc.ts). */
const MAX_SIDE = 1568;

export type PdfProblemKey = 'pdfTooBig' | 'pdfTooManyPages' | 'pdfPassword' | 'pdfInvalid';

/** A PDF we refuse; `key` is a `chat` translation key. */
export class PdfProblem extends Error {
  /** The numbers the messages mention, so every key can be translated with the same options. */
  params = { max: MAX_PDF_PAGES, mb: MAX_PDF_BYTES / 1024 / 1024 };
  constructor(public key: PdfProblemKey) {
    super(key);
  }
}

export type OpenPdf = { pages: number; renderPage: (n: number) => Promise<Uint8Array>; destroy: () => Promise<void> };

/** Opens a PDF and checks the limits. No script runs and no XFA form is built: the file is only drawn. */
export async function openPdf(file: File): Promise<OpenPdf> {
  if (file.size > MAX_PDF_BYTES) throw new PdfProblem('pdfTooBig');
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false, useSystemFonts: true });
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    if (!(e instanceof pdfjs.PasswordException)) console.error(`Opening the PDF failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`); // the toast only says "cannot read"
    throw new PdfProblem(e instanceof pdfjs.PasswordException ? 'pdfPassword' : 'pdfInvalid');
  }
  if (doc.numPages > MAX_PDF_PAGES) {
    void task.destroy();
    throw new PdfProblem('pdfTooManyPages');
  }
  return {
    pages: doc.numPages,
    async renderPage(n) {
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff'; // JPEG has no transparency: a transparent page would turn black
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/jpeg', 0.85));
        canvas.width = canvas.height = 0; // release the bitmap now, a 100-page PDF would otherwise hold them all
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        page.cleanup();
      }
    },
    destroy: () => task.destroy(),
  };
}
