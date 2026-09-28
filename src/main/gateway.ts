// LLM gateway adapter (docs/gateway-design.md G4–G9). The gateway ignores `tools` and wants string content, so tools go
// through the prompt: the model answers with a ```tool_calls block, which becomes ordinary ToolCall deltas here.
import { randomUUID } from 'node:crypto';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ToolCall } from '../shared/types';

const FENCE = '```tool_calls';
/** The call a malformed block becomes; its arguments hold the raw block. The agent answers it with an error (G9). */
export const BAD_BLOCK = 'invalid_tool_calls';

/** The tool catalog and calling protocol appended to the system prompt (G5). */
export function toolProtocol(tools: ChatCompletionFunctionTool[]): string {
  return [
    '',
    'Cách gọi tool:',
    '- Khi cần gọi tool, CHỈ trả lời đúng một khối như sau, không kèm chữ nào khác:',
    FENCE,
    '[{"name": "<tên tool>", "arguments": {<tham số theo schema>}}]',
    '```',
    '- Gọi nhiều tool cùng lúc thì đặt nhiều phần tử trong mảng. Kết quả đến ở tin nhắn sau, dạng [Kết quả tool <tên>]: <json>.',
    '- Không cần tool thì trả lời bình thường, không dùng khối này. Không tự viết kết quả tool.',
    'Danh sách tool (tên: mô tả. JSON schema của arguments):',
    ...tools.map((t) => `- ${t.function.name}: ${(t.function.description ?? '').replace(/\s+/g, ' ')} ${JSON.stringify(t.function.parameters)}`),
  ].join('\n');
}

const call = (name: string, args: string): ToolCall => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name, arguments: args } });

function parseBlock(raw: string): ToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [call(BAD_BLOCK, raw)];
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed]) as { name?: unknown; arguments?: unknown }[];
  if (!items.every((i) => typeof i?.name === 'string' && i.name)) return [call(BAD_BLOCK, raw)];
  // An unknown name or bad arguments pass through: the agent answers them with its usual tool errors.
  return items.map((i) => call(i.name as string, typeof i.arguments === 'string' ? i.arguments : JSON.stringify(i.arguments ?? {})));
}

/** The calls in every ```tool_calls block of a reply (an unclosed last block too). */
export const parseToolCalls = (text: string): ToolCall[] =>
  [...text.matchAll(/```tool_calls[^\n]*\n?([\s\S]*?)(?:```|$)/g)].flatMap((b) => parseBlock(b[1].trim()));

/** How much of a streamed reply the user may see: everything before a ```tool_calls fence, holding back a partial one (G7). */
export function visibleLength(text: string): number {
  const at = text.indexOf(FENCE);
  if (at >= 0) return at;
  for (let k = Math.min(FENCE.length - 1, text.length); k > 0; k--) if (FENCE.startsWith(text.slice(-k))) return text.length - k;
  return text.length;
}

type Content = ChatCompletionMessageParam['content'];
const textOf = (c: Content): string =>
  typeof c === 'string' ? c : (c ?? []).flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n'); // images dropped (G8)

const argsValue = (a: string): unknown => {
  try {
    return JSON.parse(a);
  } catch {
    return a;
  }
};

/** The calls as the model would have written them; a malformed block is replayed as it was. */
function toBlocks(calls: ToolCall[]): string {
  const ok = calls.filter((c) => c.function.name !== BAD_BLOCK);
  const bad = calls.filter((c) => c.function.name === BAD_BLOCK).map((c) => c.function.arguments);
  const json = ok.length ? [JSON.stringify(ok.map((c) => ({ name: c.function.name, arguments: argsValue(c.function.arguments) })))] : [];
  return [...json, ...bad].map((b) => `${FENCE}\n${b}\n\`\`\``).join('\n');
}

/**
 * The request messages in the gateway's dialect (G5, G6, G8): the tool protocol in the system prompt, tool calls as text
 * blocks, tool results as labelled strings, string content only and never empty.
 */
export function toGatewayMessages(messages: ChatCompletionMessageParam[], tools?: ChatCompletionFunctionTool[]): ChatCompletionMessageParam[] {
  const names = new Map<string, string>(); // tool_call_id → tool name, filled in order so a reused id maps to its latest call
  return messages.map((m): ChatCompletionMessageParam => {
    const text = textOf(m.content);
    if (m.role === 'system') return { role: 'system', content: tools?.length ? `${text}\n${toolProtocol(tools)}` : text };
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls as ToolCall[];
      for (const c of calls) names.set(c.id, c.function.name);
      return { role: 'assistant', content: [text.trim(), toBlocks(calls)].filter(Boolean).join('\n\n') };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: `[Kết quả tool ${names.get(m.tool_call_id) ?? '?'}]: ${text}` };
    return { role: m.role, content: text || '…' } as ChatCompletionMessageParam;
  });
}

const chunk = (delta: ChatCompletionChunk.Choice.Delta, finish: string | null = null): ChatCompletionChunk =>
  ({ id: 'gw', object: 'chat.completion.chunk', created: 0, model: 'gateway', choices: [{ index: 0, delta, finish_reason: finish }] }) as ChatCompletionChunk;

/**
 * Turns the gateway's text stream into ordinary chunks: text streams as it comes except a ```tool_calls block, which is held
 * back and emitted at the end as tool_call deltas (G7).
 */
export async function* fromGateway(stream: AsyncIterable<ChatCompletionChunk>): AsyncGenerator<ChatCompletionChunk> {
  let text = '';
  let sent = 0;
  let finish: string | null = null;
  for await (const c of stream) {
    const choice = c.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    if (!choice.delta?.content) continue;
    text += choice.delta.content;
    const visible = visibleLength(text);
    if (visible > sent) {
      yield chunk({ content: text.slice(sent, visible) });
      sent = visible;
    }
  }
  if (!text.includes(FENCE) && text.length > sent) yield chunk({ content: text.slice(sent) }); // a held-back partial fence
  for (const [index, c] of parseToolCalls(text).entries()) yield chunk({ tool_calls: [{ index, ...c }] });
  if (finish) yield chunk({}, finish);
}
