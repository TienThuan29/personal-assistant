import { APIConnectionError, APIError } from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { collect, createLlm, describeLlmError, listModels, resolveAnthropicModel } from '../src/main/llm';
import type { LlmConfig } from '../src/shared/types';
import { call, chunk, fakeLlm } from './helpers';

describe('collect', () => {
  it('merges text and split tool-call deltas', async () => {
    const texts: string[] = [];
    const scripted = fakeLlm([{ ...call('c1', 'list_tasks', { status: 'todo' }), content: 'Để mình xem' }]);
    const msg = await collect(scripted.stream({ messages: [] }), (d) => texts.push(d));
    expect(texts.join('')).toBe('Để mình xem');
    expect(msg.tool_calls).toEqual([{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{"status":"todo"}' } }]);
  });

  it('skips empty-choice chunks, keeps a repeated name once, fills a missing id', async () => {
    async function* odd() {
      yield { id: 'f', object: 'chat.completion.chunk', created: 0, model: 'x', choices: [] } as unknown as ChatCompletionChunk;
      yield chunk({ tool_calls: [{ index: 0, function: { name: 'list_tasks', arguments: '{}' } }] });
      yield chunk({ tool_calls: [{ index: 0, function: { name: 'list_tasks' } }] });
    }
    const msg = await collect(odd(), () => {});
    expect(msg.content).toBeNull();
    expect(msg.tool_calls?.[0].function).toEqual({ name: 'list_tasks', arguments: '{}' });
    expect(msg.tool_calls?.[0].id).toMatch(/^call_/);
  });

  it('keeps interleaved parallel tool calls apart and defaults empty args to {}', async () => {
    async function* parallel() {
      yield chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'list_tasks', arguments: '' } }] });
      yield chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'search_notes', arguments: '{"q":' } }] });
      yield chunk({ tool_calls: [{ index: 0, function: { arguments: '' } }] });
      yield chunk({ tool_calls: [{ index: 1, function: { arguments: '"x"}' } }] });
    }
    const msg = await collect(parallel(), () => {});
    expect(msg.tool_calls?.map((t) => [t.id, t.function.name, t.function.arguments])).toEqual([
      ['a', 'list_tasks', '{}'],
      ['b', 'search_notes', '{"q":"x"}'],
    ]);
  });

  it('appends an index-less tool-call delta to the last call', async () => {
    async function* noIndex() {
      yield chunk({ tool_calls: [{ id: 'a', function: { name: 'list_tasks', arguments: '{"status":' } }] });
      yield chunk({ tool_calls: [{ function: { arguments: '"todo"}' } }] });
    }
    const msg = await collect(noIndex(), () => {});
    expect(msg.tool_calls).toEqual([{ id: 'a', type: 'function', function: { name: 'list_tasks', arguments: '{"status":"todo"}' } }]);
  });

  it.each(['length', 'content_filter'])('rejects a reply cut off by finish_reason %s, keeping partial text', async (reason) => {
    const partial = { content: '' };
    async function* cut() {
      yield chunk({ content: 'Một nửa' });
      yield { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: reason }] } as unknown as ChatCompletionChunk;
    }
    await expect(collect(cut(), () => {}, partial)).rejects.toThrow(/bị cắt/);
    expect(partial.content).toBe('Một nửa');
  });

  it('returns an empty message when the stream has nothing', async () => {
    async function* empty() {}
    expect(await collect(empty(), () => {})).toEqual({ role: 'assistant', content: null });
  });

  async function* stream(...deltas: object[]) {
    for (const d of deltas) yield chunk(d);
  }

  it('streams reasoning_content or reasoning apart from the answer, and never puts it in the reply', async () => {
    for (const field of ['reasoning_content', 'reasoning']) {
      const texts: string[] = [];
      const thoughts: string[] = [];
      const partial = { content: '' };
      const msg = await collect(
        stream({ [field]: 'Để mình ' }, { [field]: 'nghĩ…' }, { content: 'Xin ' }, { content: 'chào' }),
        (d) => texts.push(d),
        partial,
        (d) => thoughts.push(d)
      );
      expect(thoughts.join('')).toBe('Để mình nghĩ…');
      expect(texts.join('')).toBe('Xin chào');
      expect(msg.content).toBe('Xin chào');
      expect(partial.content).toBe('Xin chào');
    }
  });

  it('splits <think> blocks written inline in the content, even when a tag is cut between chunks', async () => {
    const thoughts: string[] = [];
    const msg = await collect(stream({ content: '<thi' }, { content: 'nk>so sánh</th' }, { content: 'ink>\n\nĐáp án là 4' }), () => {}, undefined, (d) => thoughts.push(d));
    expect(thoughts.join('')).toBe('so sánh');
    expect(msg.content).toBe('Đáp án là 4');
  });

  it('leaves reasoning fields and think tags alone when reasoning is not turned on', async () => {
    const msg = await collect(stream({ reasoning_content: 'x' }, { content: '<think>y</think>z' }), () => {});
    expect(msg.content).toBe('<think>y</think>z');
  });

  it('keeps partial text when the stream breaks', async () => {
    const partial = { content: '' };
    async function* broken() {
      yield chunk({ content: 'Đang tra' });
      throw new Error('socket hang up');
    }
    await expect(collect(broken(), () => {}, partial)).rejects.toThrow('socket hang up');
    expect(partial.content).toBe('Đang tra');
  });
});

describe('describeLlmError', () => {
  it('maps common failures to Vietnamese hints', () => {
    expect(describeLlmError(new APIError(401, undefined, 'Unauthorized', undefined))).toMatch(/Cài đặt/);
    expect(describeLlmError(new APIError(404, undefined, 'Not found', undefined))).toMatch(/model/);
    expect(describeLlmError(new APIConnectionError({ message: 'down' }))).toMatch(/kết nối/);
    expect(describeLlmError(new APIError(400, undefined, 'Bad Request', undefined))).toMatch(/model/);
    const tooLong = APIError.generate(400, { error: { code: 'context_length_exceeded', message: 'too long' } }, undefined, new Headers());
    expect(describeLlmError(tooLong)).toMatch(/quá dài/);
    const filtered = APIError.generate(400, { error: { code: 'content_filter', message: 'blocked' } }, undefined, new Headers());
    expect(describeLlmError(filtered)).toMatch(/bộ lọc/);
    expect(describeLlmError(APIError.generate(500, { error: { message: 'boom' } }, undefined, new Headers()))).toBe('LLM trả lỗi: 500 boom');
  });
});

describe('createLlm', () => {
  const gateway: LlmConfig = { provider: 'gateway', endpoint: 'https://gw.example/v1', model: 'm', apiVersion: '' };

  it('refuses an unconfigured provider, incl. Azure without apiVersion', () => {
    expect(() => createLlm({ ...gateway, endpoint: '' }, 'k')).toThrow(/Cài đặt/);
    expect(() => createLlm(gateway, '')).toThrow(/Cài đặt/);
    expect(() => createLlm({ provider: 'azure', endpoint: 'https://x', model: 'm', apiVersion: '' }, 'k')).toThrow(/Cài đặt/);
  });

  const sse = (text: string) => `data: ${JSON.stringify(chunk({ content: text }))}\n\n`;
  const DONE = 'data: [DONE]\n\n';

  /** Stub fetch that records requests and streams SSE parts; `hang` keeps the body open until the request aborts. */
  function stubFetch(parts: string[], hang = false) {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
      const body = new ReadableStream<Uint8Array>({
        start(ctl) {
          for (const p of parts) ctl.enqueue(new TextEncoder().encode(p));
          if (!hang) return ctl.close();
          init?.signal?.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    return { f, seen };
  }

  it('Azure hits the deployment URL with an api-key header', async () => {
    const { f, seen } = stubFetch([sse('chào'), DONE]);
    const cfg: LlmConfig = { provider: 'azure', endpoint: 'https://r.openai.azure.com', model: 'gpt-4o', apiVersion: '2024-10-21' };
    const msg = await collect(createLlm(cfg, 'k1', { fetch: f }).stream({ messages: [] }), () => {});
    expect(msg.content).toBe('chào');
    expect(seen[0].url).toBe('https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21');
    expect(seen[0].headers.get('api-key')).toBe('k1');
  });

  it('Azure/Foundry v1 URL (even a pasted /responses one) uses /openai/v1/chat/completions with the deployment as model', async () => {
    const { f, seen } = stubFetch([sse('hi'), DONE]);
    const cfg: LlmConfig = { provider: 'azure', endpoint: 'https://r.services.ai.azure.com/openai/v1/responses', model: 'gpt-5-01', apiVersion: '2024-10-21' };
    const msg = await collect(createLlm(cfg, 'k1', { fetch: f }).stream({ messages: [] }), () => {});
    expect(msg.content).toBe('hi');
    expect(seen[0].url).toBe('https://r.services.ai.azure.com/openai/v1/chat/completions');
    expect(seen[0].headers.get('api-key')).toBe('k1');
    expect(JSON.parse(seen[0].body).model).toBe('gpt-5-01');
  });

  it('gateway hits <baseURL>/chat/completions with a bearer token', async () => {
    const { f, seen } = stubFetch([sse('ok'), DONE]);
    const msg = await collect(createLlm(gateway, 'tok', { fetch: f }).stream({ messages: [] }), () => {});
    expect(msg.content).toBe('ok');
    expect(seen[0].url).toBe('https://gw.example/v1/chat/completions');
    const host = stubFetch([sse('ok'), DONE]);
    await collect(createLlm({ ...gateway, endpoint: 'https://gw.example' }, 'tok', { fetch: host.f }).stream({ messages: [] }), () => {});
    expect(host.seen[0].url).toBe('https://gw.example/v1/chat/completions'); // host only: the app adds /v1
    expect(seen[0].headers.get('authorization')).toBe('Bearer tok');
  });

  it('gateway without a model omits the field so the gateway picks one', async () => {
    const { f, seen } = stubFetch([sse('ok'), DONE]);
    const msg = await collect(createLlm({ ...gateway, model: '' }, 'tok', { fetch: f }).stream({ messages: [] }), () => {});
    expect(msg.content).toBe('ok');
    expect(JSON.parse(seen[0].body)).not.toHaveProperty('model');
  });

  it('LM Studio needs no key, sends tools like Azure does, and does not retry', async () => {
    const lm: LlmConfig = { provider: 'lmstudio', endpoint: 'http://localhost:1234', model: 'qwen2.5-7b-instruct', apiVersion: '' };
    const { f, seen } = stubFetch([sse('xin chào'), DONE]);
    const tools = [{ type: 'function' as const, function: { name: 'list_tasks', parameters: { type: 'object', properties: {} } } }];
    const llm = createLlm(lm, '', { fetch: f });
    expect(llm.textOnly).toBe(false);
    expect(llm.reasoning).toBe(true); // LM Studio streams its reasoning
    expect(createLlm(gateway, 'tok').reasoning).toBeFalsy();
    expect(createLlm({ provider: 'azure', endpoint: 'https://r.openai.azure.com', model: 'm', apiVersion: 'v' }, 'k').reasoning).toBeFalsy();
    const msg = await collect(llm.stream({ messages: [{ role: 'user', content: 'hi' }], tools }), () => {});
    expect(msg.content).toBe('xin chào');
    expect(seen[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(seen[0].headers.get('authorization')).toBe('Bearer lm-studio');
    const body = JSON.parse(seen[0].body);
    expect(body.model).toBe('qwen2.5-7b-instruct');
    expect(body.tools).toHaveLength(1); // native tool calling: no prompt adapter
    expect(() => createLlm({ ...lm, endpoint: '' }, '')).toThrow(/Cài đặt/);
  });

  it('LM Studio without a model omits the field so the loaded model answers', async () => {
    const { f, seen } = stubFetch([sse('ok'), DONE]);
    const lm: LlmConfig = { provider: 'lmstudio', endpoint: 'http://localhost:1234/v1', model: '', apiVersion: '' };
    await collect(createLlm(lm, '', { fetch: f }).stream({ messages: [] }), () => {});
    expect(seen[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(JSON.parse(seen[0].body)).not.toHaveProperty('model');
  });

  it("lists a gateway's models with the bearer token", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return Response.json({ object: 'list', data: [{ id: 'gpt-5.1-02', object: 'model' }, { id: 'a-model', object: 'model' }] });
    }) as typeof fetch;
    expect(await listModels('https://gw.example/v1', 'tok', { fetch: f })).toEqual(['a-model', 'gpt-5.1-02']);
    expect(seen).toEqual([{ url: 'https://gw.example/v1/models', auth: 'Bearer tok' }]);
    await expect(listModels('', 'tok', { fetch: f })).rejects.toThrow(/lưu endpoint/);
    await expect(listModels('https://gw.example/v1', '', { fetch: f })).rejects.toThrow(/lưu endpoint/);
  });

  it('rejects when aborted mid-stream instead of ending silently', async () => {
    const { f } = stubFetch([sse('Đang')], true);
    const ac = new AbortController();
    const partial = { content: '' };
    const run = collect(createLlm(gateway, 'tok', { fetch: f }).stream({ messages: [], signal: ac.signal }), () => ac.abort(), partial);
    await expect(run).rejects.toThrow();
    expect(partial.content).toBe('Đang');
  });

  describe('Anthropic', () => {
    // The model cache is per process: every test uses its own key so none sees another's resolved model.
    const claude = (model = 'haiku', endpoint = 'https://api.anthropic.com'): LlmConfig => ({ provider: 'anthropic', endpoint, model, apiVersion: '' });
    const MODELS = {
      data: [
        { id: 'claude-haiku-4-5', line: 'haiku', lifecycle: 'active', created_at: '2025-10-01T00:00:00Z' },
        { id: 'claude-haiku-5-5', line: 'haiku', lifecycle: 'active', created_at: '2026-08-10T00:00:00Z' },
        { id: 'claude-haiku-3', line: 'haiku', lifecycle: 'retired', created_at: '2026-09-01T00:00:00Z' },
        { id: 'claude-haiku-no-line', line: null, lifecycle: 'active', created_at: '2026-09-02T00:00:00Z' },
        { id: 'claude-sonnet-5-5', line: 'sonnet', lifecycle: 'active', created_at: '2026-08-01T00:00:00Z' },
      ],
      has_more: false,
    };

    /** Answers /v1/models with `models` (or a status), and /v1/chat/completions with a short SSE reply (or a status). */
    function anthropicFetch(opts: { models?: unknown; modelsStatus?: number; chatStatus?: number } = {}) {
      const seen: { url: string; headers: Headers; body: string }[] = [];
      const f = (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
        if (String(url).includes('/v1/models'))
          return opts.modelsStatus ? new Response('{}', { status: opts.modelsStatus }) : Response.json(opts.models ?? MODELS);
        if (opts.chatStatus) return Response.json({ error: { message: 'nope' } }, { status: opts.chatStatus });
        return new Response(`${sse('ok')}${DONE}`, { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch;
      const listed = () => seen.filter((s) => s.url.includes('/v1/models'));
      return { f, seen, listed };
    }

    it('calls the fixed Anthropic host with the newest active model of the line, natively with tools', async () => {
      const { f, seen } = anthropicFetch();
      const tools = [{ type: 'function' as const, function: { name: 'list_tasks', parameters: { type: 'object', properties: {} } } }];
      // A stored endpoint is ignored: the key must only ever go to api.anthropic.com.
      const llm = createLlm(claude('haiku', 'https://evil.example'), 'sk-ant-t1', { fetch: f });
      expect(llm.textOnly).toBe(false); // it reads images
      expect(llm.reasoning).toBeFalsy();
      const msg = await collect(llm.stream({ messages: [{ role: 'user', content: 'hi' }], tools }), () => {});
      expect(msg.content).toBe('ok');
      expect(seen[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
      expect(seen[0].headers.get('x-api-key')).toBe('sk-ant-t1');
      expect(seen[0].headers.get('anthropic-version')).toBe('2023-06-01');
      expect(seen[1].url).toBe('https://api.anthropic.com/v1/chat/completions');
      expect(seen[1].headers.get('authorization')).toBe('Bearer sk-ant-t1');
      const body = JSON.parse(seen[1].body);
      expect(body.model).toBe('claude-haiku-5-5'); // not the retired or line-less ones, not the older one
      expect(body.tools).toHaveLength(1);
    });

    it('looks the line up once per key and hour, and per line', async () => {
      const { f, listed } = anthropicFetch();
      const run = (model: string) => collect(createLlm(claude(model), 'sk-ant-t2', { fetch: f }).stream({ messages: [] }), () => {});
      await run('haiku');
      await run('haiku');
      expect(listed()).toHaveLength(1);
      await run('sonnet');
      expect(listed()).toHaveLength(2);
      const key = 'sk-ant-t2b';
      expect(await resolveAnthropicModel('haiku', key, { fetch: f, now: 0 })).toBe('claude-haiku-5-5');
      await resolveAnthropicModel('haiku', key, { fetch: f, now: 3_599_999 });
      expect(listed()).toHaveLength(3);
      await resolveAnthropicModel('haiku', key, { fetch: f, now: 3_600_001 });
      expect(listed()).toHaveLength(4);
    });

    it('looks the line up again after the model is gone (404)', async () => {
      const { f, listed } = anthropicFetch({ chatStatus: 404 });
      const run = () => collect(createLlm(claude(), 'sk-ant-t3', { fetch: f }).stream({ messages: [] }), () => {});
      await expect(run()).rejects.toThrow();
      await expect(run()).rejects.toThrow();
      expect(listed()).toHaveLength(2);
    });

    it('needs a key and a known line', () => {
      expect(() => createLlm(claude(), '')).toThrow(/Cài đặt/);
      expect(() => createLlm(claude('claude-haiku-5-5'), 'k')).toThrow(/Cài đặt/); // an id is not a line
      expect(() => createLlm(claude('haiku', ''), 'k')).not.toThrow(); // the endpoint is not used
    });

    it('explains a bad key, a missing line and a lost connection', async () => {
      const run = (f: typeof fetch, key: string, model = 'haiku') =>
        collect(createLlm(claude(model), key, { fetch: f }).stream({ messages: [] }), () => {});
      await expect(run(anthropicFetch({ modelsStatus: 401 }).f, 'sk-ant-t4')).rejects.toThrow(/sai hoặc hết hạn/);
      await expect(run(anthropicFetch({ modelsStatus: 429 }).f, 'sk-ant-t5')).rejects.toThrow(/giới hạn tốc độ/);
      await expect(run(anthropicFetch({ modelsStatus: 500 }).f, 'sk-ant-t6')).rejects.toThrow(/500/);
      await expect(run(anthropicFetch().f, 'sk-ant-t7', 'opus')).rejects.toThrow(/dòng opus/);
      await expect(run(anthropicFetch({ models: { data: [] } }).f, 'sk-ant-t8')).rejects.toThrow(/dòng haiku/);
      const down = (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;
      await expect(run(down, 'sk-ant-t9')).rejects.toThrow(/Không kết nối được/);
    });

    it('surfaces an abort while looking the line up', async () => {
      const ac = new AbortController();
      const f = (async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
      const run = collect(createLlm(claude(), 'sk-ant-t10', { fetch: f }).stream({ messages: [], signal: ac.signal }), () => {});
      ac.abort();
      await expect(run).rejects.toThrow(/abort/i); // not "could not connect"
    });
  });
});
