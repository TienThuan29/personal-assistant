import { batchRanges } from '../src/shared/pdf';
import { checkDocument, documentLabel, nextStep, questionOf, runStart } from '../src/main/documents';
import type { ChatMessage, UserMessage } from '../src/shared/types';

let n = 0;
const at = '2026-10-05T00:00:00.000Z';
const user = (content: string, extra: Partial<UserMessage> = {}): ChatMessage => ({ role: 'user', content, ...extra, id: ++n, created_at: at });
const bot = (content: string): ChatMessage => ({ role: 'assistant', content, id: ++n, created_at: at });
const pages = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);
const pdf = (count: number, q = 'Tóm tắt') => user(q, { document: { name: 'a.pdf', pages: pages(count) } });
const batch = (part: number, parts: number) => user('batch', { batch: { name: 'a.pdf', part, parts, from: 1, to: 10, total: 25 }, attachment_ids: ['p0'] });
const final = () => user('final', { final: true });

describe('batchRanges', () => {
  it('splits into 1-based inclusive ranges of 10', () => {
    expect(batchRanges(25)).toEqual([{ from: 1, to: 10 }, { from: 11, to: 20 }, { from: 21, to: 25 }]);
    expect(batchRanges(10)).toEqual([{ from: 1, to: 10 }]);
    expect(batchRanges(1)).toEqual([{ from: 1, to: 1 }]);
    expect(batchRanges(0)).toEqual([]);
  });
});

describe('nextStep', () => {
  it('is normal without a PDF, and after the user typed something else', () => {
    expect(nextStep([])).toEqual({ kind: 'normal' });
    expect(nextStep([user('hi')])).toEqual({ kind: 'normal' });
    expect(nextStep([pdf(25), batch(1, 3), bot('n1'), user('thôi, hỏi việc khác')])).toEqual({ kind: 'normal' });
  });

  it('starts with batch 1, then goes batch by batch, then the final step', () => {
    const doc = pdf(25);
    expect(nextStep([doc])).toEqual({ kind: 'batch', part: 1, parts: 3 });
    expect(nextStep([doc, batch(1, 3), bot('n1')])).toEqual({ kind: 'batch', part: 2, parts: 3 });
    expect(nextStep([doc, batch(1, 3), bot('n1'), batch(2, 3), bot('n2')])).toEqual({ kind: 'batch', part: 3, parts: 3 });
    expect(nextStep([doc, batch(1, 3), bot('n1'), batch(2, 3), bot('n2'), batch(3, 3), bot('n3')])).toEqual({ kind: 'final' });
  });

  it('reruns a batch or final message that has no reply (error, Stop)', () => {
    expect(nextStep([pdf(25), batch(1, 3)])).toEqual({ kind: 'rerun' });
    expect(nextStep([pdf(25), batch(1, 3), bot('n1'), batch(2, 3)])).toEqual({ kind: 'rerun' });
    expect(nextStep([pdf(5), batch(1, 1), bot('n1'), final()])).toEqual({ kind: 'rerun' });
  });

  it('is normal again once the final step has been answered or is resuming after a card', () => {
    expect(nextStep([pdf(5), batch(1, 1), bot('n1'), final(), bot('answer')])).toEqual({ kind: 'normal' });
    const tool: ChatMessage = { role: 'tool', tool_call_id: 'c1', content: '{}', id: ++n, created_at: at };
    expect(nextStep([pdf(5), batch(1, 1), bot('n1'), final(), bot('…'), tool])).toEqual({ kind: 'normal' });
  });

  it('follows the latest PDF when there are several', () => {
    const msgs = [pdf(5), batch(1, 1), bot('n1'), final(), bot('a'), pdf(15), ];
    expect(nextStep(msgs)).toEqual({ kind: 'batch', part: 1, parts: 2 });
  });
});

describe('run helpers', () => {
  it('runStart points at the PDF message only while a batch/final message is the latest user message', () => {
    const doc = pdf(25);
    expect(runStart([user('a'), doc])).toBe(-1);
    expect(runStart([user('a'), doc, batch(1, 3)])).toBe(1);
    expect(runStart([doc, batch(1, 3), bot('n'), user('later')])).toBe(-1);
  });

  it('questionOf is the PDF message text, or a default for a PDF sent alone', () => {
    expect(questionOf([pdf(5, ' Tìm số liệu ')])).toBe('Tìm số liệu');
    expect(questionOf([pdf(5, '')])).toBe('Summarize this document.');
  });

  it('describes the PDF for the model without labelling every page', () => {
    const m = { content: 'Tóm tắt', document: { name: 'a.pdf', pages: pages(40) } };
    expect(documentLabel(m, false)).toBe('Tóm tắt\n[PDF "a.pdf", 40 pages, read in the parts that follow]');
    expect(documentLabel({ ...m, content: '' }, true)).toContain('cannot see images');
    expect(documentLabel(m, false)).not.toContain('ảnh #');
  });
});

describe('checkDocument', () => {
  const convert = (b: unknown) => Buffer.from(b as Uint8Array);
  const page = { name: 'p', bytes: new Uint8Array([1]) };

  it('accepts a named document with pages and converts every page', () => {
    expect(checkDocument({ name: ' a.pdf ', pages: [page, page] }, convert)).toEqual({ name: 'a.pdf', pages: [Buffer.from([1]), Buffer.from([1])] });
  });

  it('rejects junk, an empty name or page list, and more than 100 pages', () => {
    for (const bad of [null, 'x', {}, { name: '', pages: [page] }, { name: 'a', pages: [] }, { name: 'a', pages: 'x' }, { name: 'x'.repeat(201), pages: [page] }])
      expect(() => checkDocument(bad, convert)).toThrow();
    expect(() => checkDocument({ name: 'a.pdf', pages: Array(101).fill(page) }, convert)).toThrow(/100/);
    expect(checkDocument({ name: 'a.pdf', pages: Array(100).fill(page) }, convert).pages).toHaveLength(100);
  });

  it('lets a bad page throw its own error', () => {
    expect(() => checkDocument({ name: 'a', pages: [page] }, () => { throw new Error('not an image'); })).toThrow('not an image');
  });
});
