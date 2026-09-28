import OpenAI, { APIConnectionError, APIError, APIUserAbortError, AzureOpenAI } from 'openai';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AssistantMessage, LlmConfig, ToolCall } from '../shared/types';

export type StreamParams = { messages: ChatCompletionMessageParam[]; tools?: ChatCompletionFunctionTool[]; signal?: AbortSignal };
export type Llm = { stream: (p: StreamParams) => AsyncIterable<ChatCompletionChunk> };

/** One client for both providers; both speak OpenAI chat completions (design D2). */
export function createLlm(cfg: LlmConfig, apiKey: string): Llm {
  if (!cfg.endpoint || !cfg.model || !apiKey) throw new Error('Chưa cấu hình LLM. Mở Cài đặt để nhập endpoint, model và key.');
  const client =
    cfg.provider === 'azure'
      ? new AzureOpenAI({ endpoint: cfg.endpoint, apiKey, apiVersion: cfg.apiVersion, deployment: cfg.model, maxRetries: 2 })
      : new OpenAI({ baseURL: cfg.endpoint, apiKey, maxRetries: 2 });
  return {
    async *stream({ messages, tools, signal }) {
      yield* await client.chat.completions.create(
        { model: cfg.model, messages, tools: tools?.length ? tools : undefined, stream: true },
        { signal }
      );
    },
  };
}

/** Accumulates a streamed reply. `partial` keeps the text so far if the stream breaks. */
export async function collect(
  stream: AsyncIterable<ChatCompletionChunk>,
  onText: (delta: string) => void,
  partial: { content: string } = { content: '' }
): Promise<AssistantMessage> {
  const calls: ToolCall[] = [];
  for await (const c of stream) {
    const delta = c.choices[0]?.delta; // Azure sends content-filter chunks with empty `choices`
    if (!delta) continue;
    if (delta.content) {
      partial.content += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const acc = (calls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.function.name = tc.function.name; // assign like the SDK does: some providers repeat it
      if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
    }
  }
  const toolCalls = calls.filter(Boolean);
  toolCalls.forEach((tc, i) => (tc.id ||= `call_${Date.now()}_${i}`));
  return { role: 'assistant', content: partial.content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

export function describeLlmError(e: unknown): string {
  if (e instanceof APIUserAbortError) return 'Đã dừng.';
  if (e instanceof APIConnectionError) return 'Không kết nối được tới LLM endpoint. Kiểm tra mạng/proxy và URL trong Cài đặt.';
  if (e instanceof APIError) {
    if (e.status === 401 || e.status === 403) return 'API key/token sai hoặc hết hạn. Kiểm tra trong Cài đặt.';
    if (e.status === 404) return 'Không tìm thấy model/deployment. Kiểm tra endpoint và tên model trong Cài đặt.';
    if (e.status === 429) return 'LLM đang giới hạn tốc độ (429). Thử lại sau ít phút.';
    return `LLM trả lỗi ${e.status ?? ''}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
