import OpenAI, { APIConnectionError, APIError, APIUserAbortError, AzureOpenAI } from 'openai';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AssistantMessage, LlmConfig, ToolCall } from '../shared/types';
import { errMsg, te, UserError } from './errors';

export type StreamParams = { messages: ChatCompletionMessageParam[]; tools?: ChatCompletionFunctionTool[]; signal?: AbortSignal };
export type Llm = { stream: (p: StreamParams) => AsyncIterable<ChatCompletionChunk> };

/** One client for both providers; both speak OpenAI chat completions (design D2). `opts.fetch` is for tests. */
export function createLlm(cfg: LlmConfig, apiKey: string, opts: { fetch?: typeof fetch } = {}): Llm {
  if (!cfg.endpoint || !apiKey || (cfg.provider === 'azure' && (!cfg.model || !cfg.apiVersion)))
    throw new UserError('llmNotConfigured');
  const common = { apiKey, maxRetries: 2, timeout: 60_000, fetch: opts.fetch };
  const client =
    cfg.provider === 'azure'
      ? new AzureOpenAI({ ...common, endpoint: cfg.endpoint, apiVersion: cfg.apiVersion, deployment: cfg.model })
      : new OpenAI({ ...common, baseURL: cfg.endpoint });
  return {
    async *stream({ messages, tools, signal }) {
      // A gateway without a configured model chooses one itself: omit the field instead of sending "".
      const params = { model: cfg.model, messages, tools: tools?.length ? tools : undefined, stream: true as const };
      yield* await client.chat.completions.create(
        (cfg.model ? params : { ...params, model: undefined }) as typeof params,
        { signal }
      );
      signal?.throwIfAborted(); // the SDK's Stream ends silently on abort; surface it so the turn counts as stopped
    },
  };
}

/** Accumulates a streamed reply. `partial` keeps the text so far if the stream breaks or is cut off. */
export async function collect(
  stream: AsyncIterable<ChatCompletionChunk>,
  onText: (delta: string) => void,
  partial: { content: string } = { content: '' }
): Promise<AssistantMessage> {
  const calls: ToolCall[] = [];
  let finish: string | null = null;
  for await (const c of stream) {
    const choice = c.choices[0]; // Azure sends content-filter chunks with empty `choices`
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;
    if (delta.content) {
      partial.content += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? Math.max(0, calls.length - 1); // some providers omit index
      const acc = (calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.function.name = tc.function.name; // assign like the SDK does: some providers repeat it
      if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
    }
  }
  if (finish === 'length' || finish === 'content_filter')
    throw new UserError('llmTruncated');
  const toolCalls = calls.filter(Boolean);
  toolCalls.forEach((tc, i) => {
    tc.id ||= `call_${Date.now()}_${i}`;
    tc.function.arguments ||= '{}';
  });
  return { role: 'assistant', content: partial.content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

export function describeLlmError(e: unknown): string {
  if (e instanceof APIUserAbortError) return te('llmStopped');
  if (e instanceof APIConnectionError) return te('llmConnection');
  if (e instanceof APIError) {
    if (e.status === 401 || e.status === 403) return te('llmAuth');
    if (e.status === 404) return te('llmModelNotFound');
    if (e.code === 'context_length_exceeded') return te('llmContextLength');
    if (e.code === 'content_filter') return te('llmContentFilter');
    if (e.status === 429) return te('llmRateLimit');
    if (e.status === 400) return te('llmBadRequest', { message: e.message }); // e.g. a gateway that requires a model
    return te('llmError', { message: e.message }); // e.message already starts with the status
  }
  return errMsg(e);
}
