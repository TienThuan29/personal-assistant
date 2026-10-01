import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { buildLlmMessages, resolveAction, runTurn } from '../src/main/agent';
import { newAttachmentId, saveAttachment } from '../src/main/attachments';
import { gatewayBaseURL, BAD_BLOCK, fromGateway, parseToolCalls, toGatewayMessages, visibleText } from '../src/main/gateway';
import { collect, createLlm } from '../src/main/llm';
import { addMessage, createConversation, getMessages, listActions } from '../src/main/store';
import { toOpenAITools } from '../src/main/tools';
import { chunk, testDeps } from './helpers';

const block = (calls: object) => `\`\`\`tool_calls\n${JSON.stringify(calls)}\n\`\`\``;
const names = (text: string) => parseToolCalls(text).map((c) => [c.function.name, c.function.arguments]);

describe('parseToolCalls', () => {
  it('reads a block on its own, with generated ids', () => {
    const calls = parseToolCalls(block([{ name: 'get_today_overview', arguments: {} }]));
    expect(calls).toEqual([{ id: expect.stringMatching(/^call_\w{8}$/), type: 'function', function: { name: 'get_today_overview', arguments: '{}' } }]);
  });

  it('reads text + block, several calls, a single object and string arguments', () => {
    const reply = `Để mình xem nhé.\n\n\`\`\`tool_calls\n[{"name":"list_tasks","arguments":{"status":"todo"}},{"name":"list_reminders"}]\n\`\`\``;
    expect(names(reply)).toEqual([
      ['list_tasks', '{"status":"todo"}'],
      ['list_reminders', '{}'],
    ]);
    expect(names(block({ name: 'get_notes', arguments: '{"ids":[1]}' }))).toEqual([['get_notes', '{"ids":[1]}']]);
    const ids = parseToolCalls(reply).map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('reads an unclosed block and a fence with trailing spaces', () => {
    expect(names('```tool_calls  \n[{"name":"list_tasks","arguments":{}}]')).toEqual([['list_tasks', '{}']]);
  });

  it('a code fence inside a JSON string value does not close the block', () => {
    const body = 'Ví dụ:\n```js\nconsole.log(1)\n```\nhết';
    const reply = `Mình ghi lại nhé.\n${block([{ name: 'create_note', arguments: { body } }])}\nXong.`;
    const [c] = parseToolCalls(reply);
    expect(c.function.name).toBe('create_note');
    expect(JSON.parse(c.function.arguments)).toEqual({ body });
    expect(visibleText(reply)).toBe('Mình ghi lại nhé.\n\nXong.');
    // pretty-printed JSON too: an indented ``` is not at the start of a line
    expect(names('```tool_calls\n[\n  {"name": "list_tasks", "arguments": {"q": "```"}}\n]\n```')).toEqual([['list_tasks', '{"q":"```"}']]);
  });

  it('reads CRLF line endings', () => {
    expect(names('Ok\r\n```tool_calls\r\n[{"name":"list_tasks","arguments":{}}]\r\n```\r\n')).toEqual([['list_tasks', '{}']]);
    expect(visibleText('Ok\r\n```tool_calls\r\n[{"name":"list_tasks"}]\r\n```\r\nXong')).toBe('Ok\r\n\r\nXong');
  });

  it('reads a block whose closing fence follows the JSON on the same line', () => {
    const reply = '```tool_calls\n[{"name":"ask_user","arguments":{"questions":[{"question":"Mấy giờ?"}]}}]```';
    expect(names(reply)).toEqual([['ask_user', '{"questions":[{"question":"Mấy giờ?"}]}']]);
    expect(visibleText(reply)).toBe('');
  });

  it('reads an inline block on the fence line, without swallowing the next lines', () => {
    const reply = 'Xem nhé ```tool_calls [{"name":"list_tasks","arguments":{}}]```\nĐợi chút.';
    expect(names(reply)).toEqual([['list_tasks', '{}']]);
    expect(visibleText(reply)).toBe('Xem nhé \nĐợi chút.');
    expect(names('```tool_calls json\n[]\n```')).toEqual([[BAD_BLOCK, 'json']]); // an info string: told to resend
  });

  it('turns bad JSON or a nameless item into one BAD_BLOCK call holding the raw block (G9)', () => {
    expect(names('```tool_calls\n[{"name": "list_tasks", "arguments": {]\n```')).toEqual([[BAD_BLOCK, '[{"name": "list_tasks", "arguments": {]']]);
    expect(names(block([{ arguments: {} }]))).toEqual([[BAD_BLOCK, '[{"arguments":{}}]']]);
  });

  it('passes an unknown tool name through (the agent answers "no such tool")', () => {
    expect(names(block([{ name: 'send_email', arguments: { to: 'x' } }]))).toEqual([['send_email', '{"to":"x"}']]);
  });

  it('finds nothing in plain text or another code block', () => {
    expect(parseToolCalls('Hôm nay bạn có 2 task.\n```json\n[]\n```')).toEqual([]);
  });
});

describe('visibleText while streaming', () => {
  it('hides blocks, and holds back anything that could still become a fence', () => {
    expect(visibleText('Chào', true)).toBe('Chào');
    expect(visibleText('Xem nhé ```tool', true)).toBe('Xem nhé ');
    expect(visibleText('Xem ```tool_calls', true)).toBe('Xem ');
    expect(visibleText('Xem ```tool_calls\n[{"q":"\\n```', true)).toBe('Xem '); // unclosed: hidden to the end
    expect(visibleText('Mã:\n```ts', true)).toBe('Mã:\n```ts'); // another code block streams on
    expect(visibleText('Xem nhé ```tool', false)).toBe('Xem nhé ```tool'); // at the end, a partial fence is plain text
  });
});

const chunked = (text: string, size: number, finish = 'Stop'): AsyncIterable<ChatCompletionChunk> =>
  (async function* () {
    for (let i = 0; i < text.length; i += size) yield chunk({ content: text.slice(i, i + size) });
    yield { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: finish }] } as unknown as ChatCompletionChunk;
  })();

describe('fromGateway', () => {
  it('streams the text before a block and turns the block into tool calls, at any chunk size (G7)', async () => {
    const reply = `Để mình xem.\n${block([{ name: 'list_tasks', arguments: { status: 'todo' } }])}`;
    for (const size of [1, 3, 7, 1000]) {
      const shown: string[] = [];
      const msg = await collect(fromGateway(chunked(reply, size)), (d) => shown.push(d));
      expect(shown.join('')).toBe('Để mình xem.\n');
      expect(msg.tool_calls?.map((c) => c.function)).toEqual([{ name: 'list_tasks', arguments: '{"status":"todo"}' }]);
    }
  });

  it('streams a plain answer whole, including a trailing backtick, and accepts finish_reason "Stop"', async () => {
    const shown: string[] = [];
    const msg = await collect(fromGateway(chunked('Dùng lệnh `ls`', 2)), (d) => shown.push(d));
    expect(shown.join('')).toBe('Dùng lệnh `ls`');
    expect(msg).toEqual({ role: 'assistant', content: 'Dùng lệnh `ls`' });
  });

  it('streams text after a closed block, and a fence inside a JSON string stays hidden, at any chunk size', async () => {
    const body = 'a\n```js\nx\n```';
    const reply = `Trước.\n${block([{ name: 'create_note', arguments: { body } }])}\nSau.`;
    for (const size of [1, 4, 1000]) {
      const shown: string[] = [];
      const msg = await collect(fromGateway(chunked(reply, size)), (d) => shown.push(d));
      expect(shown.join('')).toBe('Trước.\n\nSau.');
      expect(msg.content).toBe('Trước.\n\nSau.');
      expect(JSON.parse(msg.tool_calls![0].function.arguments)).toEqual({ body });
    }
  });

  it('still reports a cut-off reply', async () => {
    await expect(collect(fromGateway(chunked('Một nửa', 3, 'Length')), () => {})).rejects.toThrow(/bị cắt/);
  });
});

describe('toGatewayMessages', () => {
  const history: ChatCompletionMessageParam[] = [
    { role: 'system', content: 'Bạn là trợ lý.' },
    { role: 'user', content: [{ type: 'text', text: 'Ảnh này là gì? [ảnh #ab12cd34]' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,x' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{"status":"todo"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '[]' },
    { role: 'assistant', content: 'Xem tiếp.', tool_calls: [{ id: 'c2', type: 'function', function: { name: BAD_BLOCK, arguments: '[{oops' } }] },
    { role: 'tool', tool_call_id: 'c2', content: '{"error":"x"}' },
    { role: 'assistant', content: 'Bạn không có task nào.' },
  ];

  it('rewrites tool calls, tool results and images as strings (G6, G8), and adds the protocol only with tools', () => {
    const out = toGatewayMessages(history, toOpenAITools());
    expect(out.every((m) => typeof m.content === 'string' && m.content.length > 0)).toBe(true);
    expect(out[0].content).toMatch(/^Bạn là trợ lý\.\n[\s\S]*```tool_calls[\s\S]*- create_task: [^\n]*\{"type":"object"/);
    expect(out[1]).toEqual({ role: 'user', content: 'Ảnh này là gì? [ảnh #ab12cd34]' });
    expect(out[2]).toEqual({ role: 'assistant', content: block([{ name: 'list_tasks', arguments: { status: 'todo' } }]) });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '[Tool result list_tasks]: []' });
    expect(out[4]).toEqual({ role: 'assistant', content: 'Xem tiếp.\n\n```tool_calls\n[{oops\n```' });
    expect(out[5].content).toBe(`[Tool result ${BAD_BLOCK}]: {"error":"x"}`);
    expect(out[6]).toEqual({ role: 'assistant', content: 'Bạn không có task nào.' });
    expect(toGatewayMessages(history)[0]).toEqual({ role: 'system', content: 'Bạn là trợ lý.' });
    expect(toGatewayMessages([{ role: 'user', content: '' }])[0].content).toBe('…');
  });

  it('lists every tool with its JSON schema, compactly', () => {
    const system = toGatewayMessages([{ role: 'system', content: '' }], toOpenAITools())[0].content as string;
    for (const t of toOpenAITools()) expect(system).toContain(`- ${t.function.name}: `);
    expect(system).toContain(JSON.stringify(toOpenAITools()[0].function.parameters));
    expect(system.length).toBeLessThan(20_000);
  });
});

describe('agent loop over a gateway (prompt-based tools)', () => {
  /** A stub gateway: each request streams the next scripted reply as text SSE; request bodies are kept. */
  function gateway(replies: string[]) {
    const bodies: { messages: ChatCompletionMessageParam[]; tools?: unknown }[] = [];
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const reply = replies.shift();
      if (reply === undefined) throw new Error('gateway script exhausted');
      const parts = reply.match(/[\s\S]{1,5}/g) ?? [];
      const sse = [...parts.map((p) => chunk({ content: p })), { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'Stop' }] }]
        .map((c) => `data: ${JSON.stringify(c)}\n\n`)
        .join('');
      return new Response(`${sse}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const llm = createLlm({ provider: 'gateway', endpoint: 'https://gw.example/v1', model: 'gpt-5.1-02', apiVersion: '' }, 'tok', { fetch: f });
    return { llm, bodies };
  }
  const start = (deps: ReturnType<typeof testDeps>, text: string) => {
    const conv = createConversation(deps.db);
    addMessage(deps.db, conv, { role: 'user', content: text });
    return conv;
  };

  it('read tool → answer', async () => {
    const { llm, bodies } = gateway([block([{ name: 'get_today_overview', arguments: {} }]), 'Hôm nay bạn chưa có việc gì.']);
    const deps = testDeps([], llm);
    const conv = start(deps, 'Hôm nay tôi có việc gì?');
    await runTurn(deps, conv);
    const msgs = getMessages(deps.db, conv);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(msgs[1]).toMatchObject({ content: null, tool_calls: [{ function: { name: 'get_today_overview', arguments: '{}' } }] });
    expect(msgs[3]).toMatchObject({ content: 'Hôm nay bạn chưa có việc gì.' });
    expect(deps.events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Hôm nay bạn chưa có việc gì.');
    expect(bodies.every((b) => !('tools' in b))).toBe(true);
    expect(bodies[0].messages[0].content).toContain('```tool_calls');
    expect(bodies[1].messages.slice(2)).toEqual([
      { role: 'assistant', content: block([{ name: 'get_today_overview', arguments: {} }]) },
      { role: 'tool', tool_call_id: msgs[2].role === 'tool' ? msgs[2].tool_call_id : '', content: expect.stringMatching(/^\[Tool result get_today_overview\]: \{/) },
    ]);
  });

  it('write tool → pending card → confirm → resume', async () => {
    const { llm, bodies } = gateway([`Mình tạo task nhé.\n${block([{ name: 'create_task', arguments: { title: 'Mua sữa' } }])}`, 'Đã tạo task Mua sữa.']);
    const deps = testDeps([], llm);
    const conv = start(deps, 'Thêm task mua sữa');
    await runTurn(deps, conv);
    const [action] = listActions(deps.db, conv, 'pending');
    expect(action).toMatchObject({ tool_name: 'create_task', args: { title: 'Mua sữa' } });
    expect(deps.events.at(-1)).toMatchObject({ type: 'pending' });
    expect(resolveAction(deps, action.id, 'confirm')).toBe(true);
    await runTurn(deps, conv);
    expect(deps.db.prepare('SELECT title FROM tasks').all()).toEqual([{ title: 'Mua sữa' }]);
    expect(getMessages(deps.db, conv).at(-1)).toMatchObject({ role: 'assistant', content: 'Đã tạo task Mua sữa.' });
    expect(bodies[1].messages.slice(2).map((m) => m.content)).toEqual([
      `Mình tạo task nhé.\n\n${block([{ name: 'create_task', arguments: { title: 'Mua sữa' } }])}`,
      expect.stringMatching(/^\[Tool result create_task\]: \{"ok":true/),
    ]);
  });

  it('a malformed block goes back to the model as a tool error, and it retries (G9)', async () => {
    const { llm, bodies } = gateway(['```tool_calls\n[{"name": "list_tasks", "arguments": {\n```', block([{ name: 'list_tasks', arguments: {} }]), 'Không có task.']);
    const deps = testDeps([], llm);
    const conv = start(deps, 'Có task nào?');
    await runTurn(deps, conv);
    expect(getMessages(deps.db, conv).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(bodies[1].messages.at(-1)?.content).toMatch(/^\[Tool result invalid_tool_calls\]: \{"error":"Khối tool_calls không hợp lệ/);
    expect(bodies[1].messages.at(-2)?.content).toBe('```tool_calls\n[{"name": "list_tasks", "arguments": {\n```');
  });

  it('images are never sent: the label says the model cannot see them (G8)', () => {
    const deps = testDeps([]);
    const conv = createConversation(deps.db);
    const id = newAttachmentId();
    const msg = addMessage(deps.db, conv, { role: 'user', content: 'Hóa đơn', attachment_ids: [id] });
    saveAttachment(deps.db, deps.attachmentsDir, { id, bytes: new Uint8Array([1]), mime: 'image/jpeg', ownerType: 'message', ownerId: msg });
    expect(buildLlmMessages(deps, conv, true)[1]).toEqual({ role: 'user', content: `Hóa đơn\n[ảnh #${id}] (this model cannot see images, only the labels)` });
    expect(Array.isArray(buildLlmMessages(deps, conv)[1].content)).toBe(true); // Foundry still gets the image
  });
});

describe('gatewayBaseURL', () => {
  it('adds /v1 to a bare host and never doubles it', () => {
    for (const e of ['https://gw.example', 'https://gw.example/', 'https://gw.example/v1', 'https://gw.example/v1/', ' https://gw.example/V1 '])
      expect(gatewayBaseURL(e)).toBe('https://gw.example/v1');
  });
});
