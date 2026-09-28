import { APIConnectionError, APIError } from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { collect, createLlm, describeLlmError } from '../src/main/llm';
import { DEFAULT_LLM } from '../src/shared/types';
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
  });
});

it('createLlm refuses an unconfigured provider', () => {
  expect(() => createLlm(DEFAULT_LLM, '')).toThrow(/Cài đặt/);
});
