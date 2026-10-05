import { APIConnectionError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { resolveAction } from '../src/main/agent';
import { runWithDocuments } from '../src/main/docrun';
import { addDocumentMessage } from '../src/main/documents';
import type { Llm, StreamParams } from '../src/main/llm';
import { addMessage, createConversation, getMessages, listActions } from '../src/main/store';
import type { AssistantMessage } from '../src/shared/types';
import { call, fakeLlm, say, testDeps } from './helpers';

type Deps = ReturnType<typeof testDeps>;

/** An LLM that records every request; `fail` throws on those call numbers (0-based); `onCall` runs when a call starts. */
function spy(script: AssistantMessage[], o: { fail?: number[]; textOnly?: boolean; onCall?: (i: number) => void } = {}) {
  const inner = fakeLlm(script);
  const calls: StreamParams[] = [];
  const llm: Llm = {
    textOnly: o.textOnly,
    stream(p) {
      const i = calls.push(p) - 1;
      o.onCall?.(i);
      if (o.fail?.includes(i)) throw new APIConnectionError({ message: 'down' });
      return inner.stream(p);
    },
  };
  return { llm, calls };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
function setup(pages: number, script: AssistantMessage[], o: Parameters<typeof spy>[1] = {}) {
  const s = spy(script, o);
  const deps: Deps = testDeps([], s.llm);
  const conv = createConversation(deps.db);
  addDocumentMessage(deps.db, deps.attachmentsDir, conv, 'Tóm tắt giúp tôi', { name: 'bao-cao.pdf', pages: Array(pages).fill(jpeg) });
  return { deps, conv, ...s };
}
const text = (m: ChatMessage | ChatCompletionMessageParam): string =>
  typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => ('text' in p ? p.text : `<${p.type}>`)).join('') : '';
type ChatMessage = ReturnType<typeof getMessages>[number];
const images = (p: StreamParams): number =>
  p.messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'image_url').length : 0), 0);

describe('runWithDocuments', () => {
  it('reads 25 pages in 3 batches without tools, then answers with tools, with one done at the end', async () => {
    const { deps, conv, calls } = setup(25, [say('ghi chú 1'), say('ghi chú 2'), say('ghi chú 3'), say('Bản tóm tắt cuối')]);
    await runWithDocuments(deps, conv);

    const msgs = getMessages(deps.db, conv);
    expect(msgs.map((m) => (m.role === 'user' ? (m.document ? 'pdf' : m.batch ? `batch${m.batch.part}` : 'final') : m.role))).toEqual([
      'pdf', 'batch1', 'assistant', 'batch2', 'assistant', 'batch3', 'assistant', 'final', 'assistant',
    ]);
    const batches = msgs.flatMap((m) => (m.role === 'user' && m.batch ? [m] : []));
    expect(batches.map((m) => m.attachment_ids?.length)).toEqual([10, 10, 5]);
    expect(batches.map((m) => [m.batch!.from, m.batch!.to])).toEqual([[1, 10], [11, 20], [21, 25]]);
    expect(batches[0].attachment_ids).toEqual((msgs[0] as { document: { pages: string[] } }).document.pages.slice(0, 10));

    expect(calls.map((c) => c.tools?.length ?? 0).map((n) => n > 0)).toEqual([false, false, false, true]); // only the final step has tools
    expect(calls.map(images)).toEqual([10, 10, 5, 0]); // pages go with their own batch only
    const last = calls[3].messages.map(text).join('\n');
    expect(last).toContain('ghi chú 1');
    expect(last).toContain('ghi chú 3');
    expect(last).toContain('[PDF "bao-cao.pdf", 25 pages');
    expect(last).not.toMatch(/\[ảnh #[0-9a-f]{8}\]/); // 25 pages are not labelled one by one (the system prompt's own "[ảnh #id]" is fine)

    expect(deps.events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
    expect(deps.events.filter((e) => e.type === 'progress')).toMatchObject([
      { phase: 'batch', part: 1, parts: 3, from: 1, to: 10, total: 25 },
      { phase: 'batch', part: 2, parts: 3, from: 11, to: 20 },
      { phase: 'batch', part: 3, parts: 3, from: 21, to: 25 },
      { phase: 'final', parts: 3, total: 25 },
    ]);
  });

  it('keeps every note in view in a 100-page run (the history window reaches back to the PDF)', async () => {
    const notes = Array.from({ length: 10 }, (_, i) => say(`note-${i + 1}`));
    const { deps, conv, calls } = setup(100, [...notes, say('xong')]);
    await runWithDocuments(deps, conv);
    const last = calls.at(-1)!.messages.map(text).join('\n');
    for (let i = 1; i <= 10; i++) expect(last).toContain(`note-${i}`);
    expect(last).toContain('[PDF "bao-cao.pdf", 100 pages');
  });

  it('on an error keeps the notes so far, and Retry resumes at the failed batch', async () => {
    const { deps, conv, calls } = setup(25, [say('ghi chú 1')], { fail: [1] });
    await runWithDocuments(deps, conv);
    expect(deps.events.at(-1)).toMatchObject({ type: 'error' });
    expect(deps.events.some((e) => e.type === 'done')).toBe(false);
    const batchCount = () => getMessages(deps.db, conv).filter((m) => m.role === 'user' && m.batch).length;
    expect(batchCount()).toBe(2); // batch 2 was added and is waiting for a reply

    const good = spy([say('ghi chú 2'), say('ghi chú 3'), say('Cuối')]);
    deps.llm = () => good.llm;
    deps.events.length = 0;
    await runWithDocuments(deps, conv);
    expect(batchCount()).toBe(3); // batch 2 was rerun, not added again
    expect(good.calls).toHaveLength(3);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Cuối' });
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
    expect(calls).toHaveLength(2);
  });

  it('Stop ends the run after the current batch and starts no more', async () => {
    const ctl = new AbortController();
    const { deps, conv, calls } = setup(25, [say('ghi chú 1'), say('x'), say('y'), say('z')], { onCall: (i) => i === 0 && queueMicrotask(() => ctl.abort()) });
    await runWithDocuments(deps, conv, ctl.signal);
    expect(calls).toHaveLength(1);
    expect(getMessages(deps.db, conv).filter((m) => m.role === 'user' && m.batch)).toHaveLength(1);
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
    expect(deps.events.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('ignores a tool call the model makes in a batch step (tools were not offered)', async () => {
    const { deps, conv } = setup(5, [{ ...call('c1', 'create_task', { title: 'x' }), content: 'ghi chú' }, say('Cuối')]);
    await runWithDocuments(deps, conv);
    expect(listActions(deps.db, conv, 'pending')).toHaveLength(0);
    const first = getMessages(deps.db, conv).find((m) => m.role === 'assistant')!;
    expect(first).toMatchObject({ content: 'ghi chú' });
    expect('tool_calls' in first).toBe(false);
  });

  it('a confirmation card in the final step ends the run, and resolving it continues as a normal turn', async () => {
    const { deps, conv, calls } = setup(5, [say('ghi chú'), call('c1', 'create_task', { title: 'Nộp báo cáo' }), say('Đã tạo task.')]);
    await runWithDocuments(deps, conv);
    expect(deps.events.at(-1)).toMatchObject({ type: 'pending' });
    const [action] = listActions(deps.db, conv, 'pending');
    expect(resolveAction(deps, action.id, 'confirm')).toBe(true);
    await runWithDocuments(deps, conv);
    expect(calls).toHaveLength(3); // no batch was repeated
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Đã tạo task.' });
  });

  it('a message typed after the run is an ordinary turn', async () => {
    const { deps, conv, calls } = setup(5, [say('ghi chú'), say('Cuối'), say('Không có gì')]);
    await runWithDocuments(deps, conv);
    addMessage(deps.db, conv, { role: 'user', content: 'Cảm ơn' });
    await runWithDocuments(deps, conv);
    expect(calls).toHaveLength(3);
    expect(calls[2].tools?.length).toBeGreaterThan(0);
    expect(getMessages(deps.db, conv).filter((m) => m.role === 'user' && (m.batch || m.final))).toHaveLength(2);
  });

  it('a model that cannot see images gets the PDF message alone, with no batches', async () => {
    const { deps, conv, calls } = setup(25, [say('Mình không đọc được ảnh')], { textOnly: true });
    await runWithDocuments(deps, conv);
    expect(calls).toHaveLength(1);
    expect(images(calls[0])).toBe(0);
    expect(calls[0].messages.map(text).join('\n')).toContain('cannot see images');
    expect(getMessages(deps.db, conv).filter((m) => m.role === 'user' && m.batch)).toHaveLength(0);
  });

  it('a PDF sent without text asks for a summary', async () => {
    const s = spy([say('n'), say('Cuối')]);
    const deps = testDeps([], s.llm);
    const conv = createConversation(deps.db);
    addDocumentMessage(deps.db, deps.attachmentsDir, conv, '', { name: 'a.pdf', pages: [jpeg] });
    await runWithDocuments(deps, conv);
    expect(s.calls[0].messages.map(text).join('\n')).toContain('Summarize this document.');
  });
});
