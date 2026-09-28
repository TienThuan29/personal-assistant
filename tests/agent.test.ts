import { APIConnectionError } from 'openai';
import { buildLlmMessages, cancelOpenActions, MAX_ROUNDS, resolveAction, runTurn } from '../src/main/agent';
import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import type { Llm } from '../src/main/llm';
import { addMessage, createConversation, getAction, getMessages, listActions } from '../src/main/store';
import { call, chunk, say, testDeps } from './helpers';

type Deps = ReturnType<typeof testDeps>;

const start = (deps: Deps, text = 'hi'): number => {
  const conv = createConversation(deps.db);
  addMessage(deps.db, conv, { role: 'user', content: text });
  return conv;
};
const count = (deps: Deps, table: string): number => (deps.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const toolResults = (deps: Deps, conv: number) =>
  getMessages(deps.db, conv).flatMap((m) => (m.role === 'tool' ? [JSON.parse(m.content)] : []));

describe('runTurn', () => {
  it('runs read tools immediately and continues', async () => {
    const deps = testDeps([call('c1', 'list_tasks', {}), say('Bạn không có task nào.')]);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(toolResults(deps, conv)).toEqual([[]]);
    expect(deps.events.map((e) => e.type)).toContain('tool');
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('parks write tools without touching data', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'Mua sữa' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(listActions(deps.db, conv, 'pending')).toHaveLength(1);
    expect(count(deps, 'tasks')).toBe(0);
    expect(deps.events.at(-1)).toMatchObject({ type: 'pending' });
  });

  it('confirm applies, answers the tool call, and the turn resumes', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'Mua sữa' }), say('Đã tạo task.')]);
    const conv = start(deps);
    await runTurn(deps, conv);
    const [action] = listActions(deps.db, conv, 'pending');
    expect(resolveAction(deps, action.id, 'confirm')).toBe(true);
    await runTurn(deps, conv);
    expect(count(deps, 'tasks')).toBe(1);
    expect(getAction(deps.db, action.id)).toMatchObject({ status: 'confirmed', result: { title: 'Mua sữa' } });
    expect(toolResults(deps, conv)[0]).toMatchObject({ ok: true });
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Đã tạo task.' });
  });

  it('re-validates edited args; invalid edits keep the action pending', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'Mua sữa' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    const [action] = listActions(deps.db, conv, 'pending');
    expect(() => resolveAction(deps, action.id, 'confirm', { title: '' })).toThrow();
    expect(getAction(deps.db, action.id)?.status).toBe('pending');
    resolveAction(deps, action.id, 'confirm', { title: 'Mua bánh' });
    expect(deps.db.prepare('SELECT title FROM tasks').get()).toEqual({ title: 'Mua bánh' });
    expect(() => resolveAction(deps, action.id, 'confirm')).toThrow(/đã được xử lý/);
  });

  it('cancel tells the model', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'x' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    resolveAction(deps, listActions(deps.db, conv)[0].id, 'cancel');
    expect(toolResults(deps, conv)[0]).toMatchObject({ cancelled: true });
    expect(count(deps, 'tasks')).toBe(0);
  });

  it('apply errors are recorded on the action and sent to the model', async () => {
    const deps = testDeps([call('c1', 'create_reminder', { message: 'x', remind_at: '2026-09-28T08:00' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    const [action] = listActions(deps.db, conv);
    resolveAction(deps, action.id, 'confirm');
    expect(getAction(deps.db, action.id)).toMatchObject({ status: 'cancelled', result: { error: expect.stringMatching(/đã qua/) } });
    expect(toolResults(deps, conv)[0]).toMatchObject({ error: expect.stringMatching(/đã qua/) });
  });

  it('invalid tool args become a tool error and the loop continues', async () => {
    const deps = testDeps([call('c1', 'create_task', {}), say('Bạn muốn đặt tên task là gì?')]);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(toolResults(deps, conv)[0].error).toMatch(/title/);
    expect(listActions(deps.db, conv)).toEqual([]);
  });

  it(`stops after ${MAX_ROUNDS} rounds`, async () => {
    const deps = testDeps(Array.from({ length: MAX_ROUNDS }, (_, i) => call(`c${i}`, 'list_tasks', {})));
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining(String(MAX_ROUNDS)) });
  });

  it('a new user message cancels open actions', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'x' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    cancelOpenActions(deps, conv);
    expect(listActions(deps.db, conv, 'pending')).toEqual([]);
  });

  it('LLM errors keep partial text and emit an error', async () => {
    const broken: Llm = {
      async *stream() {
        yield chunk({ content: 'Đang tra' });
        throw new APIConnectionError({ message: 'down' });
      },
    };
    const deps = testDeps([], broken);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining('Đang tra') });
    expect(deps.events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/kết nối/) });
  });

  it('an empty reply is not saved and emits an error', async () => {
    const deps = testDeps([{ role: 'assistant', content: null }]);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).map((m) => m.role)).toEqual(['user']);
    expect(deps.events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/không trả lời/) });
  });

  it('stop mid-stream saves the partial text, ends with done and parks nothing', async () => {
    const ac = new AbortController();
    const stopped: Llm = {
      async *stream({ signal }) {
        yield chunk({ content: 'Để mình' });
        ac.abort();
        signal?.throwIfAborted();
        yield* fakeCall();
      },
    };
    const deps = testDeps([], stopped);
    const conv = start(deps);
    await runTurn(deps, conv, ac.signal);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining('Để mình') });
    expect(listActions(deps.db, conv)).toEqual([]);
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('stop landing at the end of the stream keeps the text but runs no tool calls', async () => {
    const ac = new AbortController();
    const stopped: Llm = {
      async *stream() {
        yield chunk({ content: 'Tạo nhé' });
        yield* fakeCall();
        ac.abort();
      },
    };
    const deps = testDeps([], stopped);
    const conv = start(deps);
    await runTurn(deps, conv, ac.signal);
    expect(getMessages(deps.db, conv).at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: 'Tạo nhé' }));
    expect(getMessages(deps.db, conv).at(-1)).not.toHaveProperty('tool_calls');
    expect(listActions(deps.db, conv)).toEqual([]);
    expect(deps.events.at(-1)).toMatchObject({ type: 'done' });
  });
});

/** Chunks of one create_task call. */
function* fakeCall() {
  yield chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'create_task', arguments: '{"title":"x"}' } }] });
}

describe('buildLlmMessages', () => {
  it('sends images only with the latest user message; older ones become labels', () => {
    const deps = testDeps([]);
    const conv = createConversation(deps.db);
    for (const text of ['ảnh 1', 'ảnh 2']) {
      const id = newAttachmentId();
      const msg = addMessage(deps.db, conv, { role: 'user', content: text, attachment_ids: [id] });
      saveAttachment(deps.db, deps.attachmentsDir, { id, bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId: msg });
      addMessage(deps.db, conv, say('ok'));
    }
    const msgs = buildLlmMessages(deps, conv);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toMatch(/\[ảnh #[0-9a-f]{8}\]/);
    expect(msgs[3].content).toEqual([
      { type: 'text', text: expect.stringContaining('ảnh 2') },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/) } },
    ]);
  });
});
