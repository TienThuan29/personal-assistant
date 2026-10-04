import OpenAI, { APIConnectionError, APIError, APIUserAbortError, AzureOpenAI } from 'openai';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AssistantMessage, LlmConfig, ToolCall } from '../shared/types';
import { errMsg, te, UserError } from './errors';
import { fromGateway, gatewayBaseURL, toGatewayMessages } from './gateway';

export type StreamParams = { messages: ChatCompletionMessageParam[]; tools?: ChatCompletionFunctionTool[]; signal?: AbortSignal };
/** `textOnly`: the provider takes no images (the gateway, design G8). */
/** LM Studio's server ignores the key but the SDK insists on one. */
export const LOCAL_KEY = 'lm-studio';
export type Llm = { stream: (p: StreamParams) => AsyncIterable<ChatCompletionChunk>; textOnly?: boolean };

/**
 * One client for every provider; all speak OpenAI chat completions (design D2). The gateway ignores `tools`, so its
 * requests and replies go through the prompt-based adapter in gateway.ts (G4). LM Studio takes `tools` and images like Azure,
 * and shares the gateway's `<host>/v1` base URL. `opts.fetch` is Electron's net.fetch or a test stub.
 */
export function createLlm(cfg: LlmConfig, apiKey: string, opts: { fetch?: typeof fetch } = {}): Llm {
  const local = cfg.provider === 'lmstudio';
  const key = apiKey || (local ? LOCAL_KEY : '');
  if (!cfg.endpoint || !key || (cfg.provider === 'azure' && (!cfg.model || !cfg.apiVersion)))
    throw new UserError('llmNotConfigured');
  // A local model may need a minute to load before the first token, and a retry would just load it again.
  const common = { apiKey: key, maxRetries: local ? 0 : 2, timeout: local ? 300_000 : 60_000, fetch: opts.fetch };
  // A pasted Azure/Foundry "v1" URL (…/openai/v1[/responses]) has no deployment path or api-version: use the plain client
  // on …/openai/v1 with the deployment as `model`; Azure takes the key as api-key (Bearer is also sent by the SDK).
  const v1 = cfg.provider === 'azure' ? /^(.*?\/openai\/v1)(?:\/|$)/i.exec(cfg.endpoint.trim())?.[1] : undefined;
  const client = v1
    ? new OpenAI({ ...common, baseURL: v1, defaultHeaders: { 'api-key': apiKey } })
    : cfg.provider === 'azure'
      ? new AzureOpenAI({ ...common, endpoint: cfg.endpoint, apiVersion: cfg.apiVersion, deployment: cfg.model })
      : new OpenAI({ ...common, baseURL: gatewayBaseURL(cfg.endpoint) });
  const gateway = cfg.provider === 'gateway';
  return {
    textOnly: gateway,
    async *stream({ messages, tools, signal }) {
      const params = gateway
        ? { model: cfg.model, messages: toGatewayMessages(messages, tools), stream: true as const }
        : { model: cfg.model, messages, tools: tools?.length ? tools : undefined, stream: true as const };
      // A gateway without a configured model chooses one itself: omit the field instead of sending "".
      const reply = await client.chat.completions.create((cfg.model ? params : { ...params, model: undefined }) as typeof params, { signal });
      yield* gateway ? fromGateway(reply) : reply;
      signal?.throwIfAborted(); // the SDK's Stream ends silently on abort; surface it so the turn counts as stopped
    },
  };
}

/** A gateway's or LM Studio's model ids: GET <host>/v1/models with the key as a bearer token (design G2). */
export async function listModels(endpoint: string, apiKey: string, opts: { fetch?: typeof fetch } = {}): Promise<string[]> {
  if (!endpoint || !apiKey) throw new UserError('modelsNeedConfig');
  const client = new OpenAI({ apiKey, baseURL: gatewayBaseURL(endpoint), maxRetries: 1, timeout: 20_000, fetch: opts.fetch });
  const ids: string[] = [];
  for await (const m of client.models.list()) if (typeof m?.id === 'string') ids.push(m.id);
  return ids.sort();
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
    if (choice.finish_reason) finish = choice.finish_reason.toLowerCase(); // the gateway sends "Stop"
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
