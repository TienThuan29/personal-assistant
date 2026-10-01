import { APIConnectionError } from 'openai';
import { answerAction, buildLlmMessages, cancelOpenActions, MAX_ROUNDS, resolveAction, runTurn } from '../src/main/agent';
import type { AssistantMessage } from '../src/shared/types';
import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import type { Llm } from '../src/main/llm';
import { tx } from '../src/main/db';
import { addMessage, createConversation, getAction, getMessages, listActions } from '../src/main/store';
import { call, chunk, fakeLlm, say, testDeps } from './helpers';

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

  it('cancelOpenActions works inside an outer transaction', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'x' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    tx(deps.db, () => cancelOpenActions(deps, conv));
    expect(listActions(deps.db, conv).map((a) => a.status)).toEqual(['cancelled']);
    expect(toolResults(deps, conv)).toEqual([expect.objectContaining({ cancelled: true })]);
  });

  it('does not call the LLM while an action is pending', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'x' })]);
    const conv = start(deps);
    await runTurn(deps, conv); // parks; the script is now exhausted, so another LLM call would emit an error
    deps.events.length = 0;
    await runTurn(deps, conv);
    expect(deps.events).toEqual([{ type: 'pending', conversationId: conv }]);
  });

  it('a parallel read and write: the read is answered now, the write after confirm, and the model sees both', async () => {
    const seen: string[][] = [];
    const inner = fakeLlm([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'r1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } },
          { id: 'w1', type: 'function', function: { name: 'create_task', arguments: '{"title":"x"}' } },
        ],
      },
      say('Xong.'),
    ]);
    const spy: Llm = {
      stream: (p) => {
        seen.push(p.messages.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : [])));
        return inner.stream(p);
      },
    };
    const deps = testDeps([], spy);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(toolResults(deps, conv)).toEqual([[]]);
    const [action] = listActions(deps.db, conv, 'pending');
    expect(action.tool_call_id).toBe('w1');
    expect(resolveAction(deps, action.id, 'confirm')).toBe(true);
    await runTurn(deps, conv);
    expect(seen.at(-1)).toEqual(['r1', 'w1']);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Xong.' });
  });

  it('links each parked action to its assistant message, even when a gateway reuses tool_call_ids', async () => {
    const deps = testDeps([call('call_0', 'create_task', { title: 'A' }), say('Ok.'), call('call_0', 'create_task', { title: 'B' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    resolveAction(deps, listActions(deps.db, conv, 'pending')[0].id, 'confirm');
    await runTurn(deps, conv);
    addMessage(deps.db, conv, { role: 'user', content: 'again' });
    await runTurn(deps, conv);
    const withCalls = getMessages(deps.db, conv).filter((m) => m.role === 'assistant' && m.tool_calls);
    expect(listActions(deps.db, conv).map((a) => [a.tool_call_id, a.message_id])).toEqual([
      ['call_0', withCalls[0].id],
      ['call_0', withCalls[1].id],
    ]);
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

describe('ask_user', () => {
  const ask = (questions: object[]) => call('a1', 'ask_user', { questions });
  const price = { question: 'Bao nhiêu tiền?', options: ['30k', '50k'] };
  const when = { question: 'Nhắc lúc nào?', options: ['8h', '12h', '18h'], multiple: true };

  /** Parks an ask, as the model would. */
  async function parked(questions: object[]) {
    const deps = testDeps([ask(questions), say('Ok.')]);
    const conv = start(deps);
    await runTurn(deps, conv);
    return { deps, conv, action: listActions(deps.db, conv, 'pending')[0] };
  }

  it('parks the call, pauses the turn and stores the questions with their defaults', async () => {
    const { deps, conv, action } = await parked([{ question: 'Ghi gì?' }]);
    expect(action).toMatchObject({ tool_name: 'ask_user', args: { questions: [{ question: 'Ghi gì?', options: [], multiple: false }] } });
    expect(deps.events.at(-1)).toMatchObject({ type: 'pending' });
    expect(toolResults(deps, conv)).toEqual([]);
  });

  it('rejects too many questions or options as a tool error', async () => {
    const q = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `q${i}` }));
    const deps = testDeps([ask(q(5)), ask([{ question: 'q', options: ['1', '2', '3', '4', '5'] }]), say('Hỏi lại.')]);
    const conv = start(deps);
    await runTurn(deps, conv);
    expect(listActions(deps.db, conv)).toEqual([]);
    expect(toolResults(deps, conv)).toHaveLength(2);
  });

  it('answers the tool call with the replies, in order, and resumes the turn', async () => {
    const { deps, conv, action } = await parked([price, when]);
    const replies = [{ picked: ['50k'] }, { picked: ['8h', '18h'], other: ' 21h ' }];
    expect(answerAction(deps, action.id, replies)).toBe(true);
    expect(getAction(deps.db, action.id)).toMatchObject({ status: 'confirmed' });
    const answers = [
      { question: 'Bao nhiêu tiền?', picked: ['50k'] },
      { question: 'Nhắc lúc nào?', picked: ['8h', '18h'], other: '21h' },
    ];
    expect(toolResults(deps, conv)).toEqual([{ answers }]);
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Ok.' });
  });

  it('accepts free text alone, also for a question without options', async () => {
    const { deps, action } = await parked([price, { question: 'Ghi gì?' }]);
    expect(answerAction(deps, action.id, [{ picked: [], other: '45k' }, { picked: [], other: 'sữa' }])).toBe(true);
  });

  it.each([
    ['an unknown option', [{ picked: ['99k'] }, { picked: ['8h'] }]],
    ['two picks on a single-choice question', [{ picked: ['30k', '50k'] }, { picked: ['8h'] }]],
    ['a pick and Other on a single-choice question', [{ picked: ['30k'], other: 'x' }, { picked: ['8h'] }]],
    ['an empty answer', [{ picked: [] }, { picked: ['8h'] }]],
    ['a blank Other', [{ picked: [], other: '   ' }, { picked: ['8h'] }]],
    ['a repeated pick', [{ picked: ['30k'] }, { picked: ['8h', '8h'] }]],
    ['too long an Other', [{ picked: [], other: 'x'.repeat(501) }, { picked: ['8h'] }]],
    ['too few replies', [{ picked: ['30k'] }]],
    ['no replies', 'oops'],
  ])('rejects %s and leaves the card pending', async (_name, replies) => {
    const { deps, conv, action } = await parked([price, when]);
    expect(() => answerAction(deps, action.id, replies)).toThrow(/không hợp lệ/);
    expect(getAction(deps.db, action.id)?.status).toBe('pending');
    expect(toolResults(deps, conv)).toEqual([]);
  });

  it('cannot be answered twice, nor confirmed as a write', async () => {
    const { deps, action } = await parked([price]);
    expect(() => resolveAction(deps, action.id, 'confirm')).toThrow();
    answerAction(deps, action.id, [{ picked: ['30k'] }]);
    expect(() => answerAction(deps, action.id, [{ picked: ['30k'] }])).toThrow(/đã được xử lý/);
  });

  it('answerAction refuses a write card', async () => {
    const deps = testDeps([call('c1', 'create_task', { title: 'x' })]);
    const conv = start(deps);
    await runTurn(deps, conv);
    const [action] = listActions(deps.db, conv, 'pending');
    expect(() => answerAction(deps, action.id, [])).toThrow(/không hợp lệ/);
    expect(getAction(deps.db, action.id)?.status).toBe('pending');
  });

  it('is not resumed while a write card beside it is still pending', async () => {
    const both: AssistantMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'a1', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [price] }) } },
        { id: 'w1', type: 'function', function: { name: 'create_task', arguments: '{"title":"x"}' } },
      ],
    };
    const deps = testDeps([both]);
    const conv = start(deps);
    await runTurn(deps, conv);
    const [askAction, write] = listActions(deps.db, conv, 'pending');
    expect(answerAction(deps, askAction.id, [{ picked: ['30k'] }])).toBe(false);
    expect(resolveAction(deps, write.id, 'cancel')).toBe(true);
  });

  it('a new user message closes it as answered in chat and tells the model', async () => {
    const { deps, conv, action } = await parked([price]);
    tx(deps.db, () => cancelOpenActions(deps, conv));
    expect(getAction(deps.db, action.id)).toMatchObject({ status: 'cancelled', result: { inChat: true } });
    expect(toolResults(deps, conv)).toEqual([expect.objectContaining({ skipped: true })]);
  });
});

/** Chunks of one create_task call. */
function* fakeCall() {
  yield chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'create_task', arguments: '{"title":"x"}' } }] });
}

describe('buildLlmMessages', () => {
  it('the history window starts on a user message', () => {
    const deps = testDeps([]);
    const conv = createConversation(deps.db);
    addMessage(deps.db, conv, { role: 'user', content: 'cũ' });
    addMessage(deps.db, conv, say('ok'));
    addMessage(deps.db, conv, { role: 'user', content: 'mới' });
    for (let i = 0; i < 12; i++) {
      addMessage(deps.db, conv, call(`c${i}`, 'list_tasks', {}));
      addMessage(deps.db, conv, { role: 'tool', tool_call_id: `c${i}`, content: '[]' });
    }
    const all = getMessages(deps.db, conv);
    expect(all[all.length - 20].role).toBe('assistant'); // the raw cut would start mid tool loop
    const msgs = buildLlmMessages(deps, conv);
    expect(msgs[1]).toEqual({ role: 'user', content: 'mới' });
    expect(msgs).toHaveLength(1 + 25);
  });

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
