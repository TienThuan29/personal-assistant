import { APIConnectionError, APIError } from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { collect, createLlm, describeLlmError, listModels } from '../src/main/llm';
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
});
