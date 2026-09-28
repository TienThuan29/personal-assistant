import OpenAI, { APIConnectionError, APIError, APIUserAbortError, AzureOpenAI } from 'openai';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AssistantMessage, LlmConfig, ToolCall } from '../shared/types';

export type StreamParams = { messages: ChatCompletionMessageParam[]; tools?: ChatCompletionFunctionTool[]; signal?: AbortSignal };
export type Llm = { stream: (p: StreamParams) => AsyncIterable<ChatCompletionChunk> };

/** One client for both providers; both speak OpenAI chat completions (design D2). `opts.fetch` is for tests. */
export function createLlm(cfg: LlmConfig, apiKey: string, opts: { fetch?: typeof fetch } = {}): Llm {
  if (!cfg.endpoint || !cfg.model || !apiKey || (cfg.provider === 'azure' && !cfg.apiVersion))
    throw new Error('Chưa cấu hình LLM. Mở Cài đặt để nhập endpoint, model và key.');
  const common = { apiKey, maxRetries: 2, timeout: 60_000, fetch: opts.fetch };
  const client =
    cfg.provider === 'azure'
      ? new AzureOpenAI({ ...common, endpoint: cfg.endpoint, apiVersion: cfg.apiVersion, deployment: cfg.model })
      : new OpenAI({ ...common, baseURL: cfg.endpoint });
  return {
    async *stream({ messages, tools, signal }) {
      yield* await client.chat.completions.create(
        { model: cfg.model, messages, tools: tools?.length ? tools : undefined, stream: true },
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
    throw new Error('Câu trả lời bị cắt (vượt giới hạn độ dài hoặc bị bộ lọc nội dung chặn). Thử lại hoặc chia nhỏ yêu cầu.');
  const toolCalls = calls.filter(Boolean);
  toolCalls.forEach((tc, i) => {
    tc.id ||= `call_${Date.now()}_${i}`;
    tc.function.arguments ||= '{}';
  });
  return { role: 'assistant', content: partial.content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

export function describeLlmError(e: unknown): string {
  if (e instanceof APIUserAbortError) return 'Đã dừng.';
  if (e instanceof APIConnectionError) return 'Không kết nối được tới LLM endpoint. Kiểm tra mạng/proxy và URL trong Cài đặt.';
  if (e instanceof APIError) {
    if (e.status === 401 || e.status === 403) return 'API key/token sai hoặc hết hạn. Kiểm tra trong Cài đặt.';
    if (e.status === 404) return 'Không tìm thấy model/deployment. Kiểm tra endpoint và tên model trong Cài đặt.';
    if (e.code === 'context_length_exceeded') return 'Hội thoại quá dài, hãy tạo hội thoại mới.';
    if (e.code === 'content_filter') return 'Yêu cầu bị bộ lọc nội dung của LLM chặn. Hãy diễn đạt lại.';
    if (e.status === 429) return 'LLM đang giới hạn tốc độ (429). Thử lại sau ít phút.';
    return `LLM trả lỗi: ${e.message}`; // e.message already starts with the status
  }
  return e instanceof Error ? e.message : String(e);
}
