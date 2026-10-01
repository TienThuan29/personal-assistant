// LLM gateway adapter (docs/gateway-design.md G4–G9). The gateway ignores `tools` and wants string content, so tools go
// through the prompt: the model answers with a ```tool_calls block, which becomes ordinary ToolCall deltas here.
import { randomUUID } from 'node:crypto';
import type { ChatCompletionChunk, ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ToolCall } from '../shared/types';

const FENCE = '```tool_calls';
/** The call a malformed block becomes; its arguments hold the raw block. The agent answers it with an error (G9). */
export const BAD_BLOCK = 'invalid_tool_calls';

/** The gateway serves everything under /v1: users enter just the host; a trailing /v1 is tolerated (never /v1/v1). */
export const gatewayBaseURL = (endpoint: string): string =>
  `${endpoint.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1`;

/** The tool catalog and calling protocol appended to the system prompt (G5). */
export function toolProtocol(tools: ChatCompletionFunctionTool[]): string {
  return [
    '',
    'How to call tools:',
    '- When you need to call a tool, reply with ONLY a block like this, with no other text:',
    FENCE,
    '[{"name": "<tool name>", "arguments": {<arguments following the schema>}}]',
    '```',
    '- To call several tools at once, put several elements in the array. The results arrive in the next message, as [Tool result <name>]: <json>.',
    '- When no tool is needed, reply normally without this block. Never write tool results yourself.',
    '- Always close the block with ``` on its own line, and make sure every bracket in the JSON is closed.',
    '- To ask the user anything (missing details, a choice, a clarification) call ask_user; never ask in plain text. Example of a complete reply:',
    FENCE,
    '[{"name": "ask_user", "arguments": {"questions": [{"question": "What time should I remind you?", "options": ["08:00", "12:00", "18:00"], "multiple": false}]}}]',
    '```',
    'Tools (name: description. JSON schema of arguments):',
    ...tools.map((t) => `- ${t.function.name}: ${(t.function.description ?? '').replace(/\s+/g, ' ')} ${JSON.stringify(t.function.parameters)}`),
  ].join('\n');
}

const call = (name: string, args: string): ToolCall => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name, arguments: args } });

function parseBlock(raw: string): ToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/`{3}$/, '')); // models often close the fence right after the JSON instead of on its own line
  } catch {
    return [call(BAD_BLOCK, raw)];
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed]) as { name?: unknown; arguments?: unknown }[];
  if (!items.every((i) => typeof i?.name === 'string' && i.name)) return [call(BAD_BLOCK, raw)];
  // An unknown name or bad arguments pass through: the agent answers them with its usual tool errors.
  return items.map((i) => call(i.name as string, typeof i.arguments === 'string' ? i.arguments : JSON.stringify(i.arguments ?? {})));
}

/**
 * A ```tool_calls block, used by both the parser and the stream so they always agree on where a block ends:
 * - on its own lines: the body runs to a closing ``` at the START of a line (JSON strings hold no raw newlines, so a fence
 *   inside a string value, e.g. a note with code, never closes it), or to the end of the reply when unclosed;
 * - inline (JSON on the fence line): the rest of that line, minus a trailing ```.
 * Every fence matches, so text the stream hides always becomes at least one call (maybe BAD_BLOCK).
 */
const BLOCK = /```tool_calls(?:[ \t]*\r?\n([\s\S]*?)(?:\r?\n```[ \t]*(?=\r?\n|$)|$)|([^\n]*))/g;

/** The calls in every ```tool_calls block of a reply. */
export const parseToolCalls = (text: string): ToolCall[] =>
  [...text.matchAll(BLOCK)].flatMap((m) => parseBlock((m[1] ?? m[2].trim().replace(/`{3}$/, '')).trim()));

/**
 * The reply as the user sees it: every block removed. While `streaming`, a trailing partial fence is held back too (G7).
 * An unclosed block runs to the end, so this only grows as text arrives.
 */
export function visibleText(text: string, streaming = false): string {
  const visible = text.replace(BLOCK, '');
  if (!streaming) return visible;
  for (let k = Math.min(FENCE.length - 1, visible.length); k > 0; k--) if (FENCE.startsWith(visible.slice(-k))) return visible.slice(0, -k);
  return visible;
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
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: `[Tool result ${names.get(m.tool_call_id) ?? '?'}]: ${text}` };
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
  let shown = '';
  let finish: string | null = null;
  const show = function* (visible: string) {
    if (visible.length <= shown.length || !visible.startsWith(shown)) return; // only ever append
    yield chunk({ content: visible.slice(shown.length) });
    shown = visible;
  };
  for await (const c of stream) {
    const choice = c.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    if (!choice.delta?.content) continue;
    text += choice.delta.content;
    yield* show(visibleText(text, true));
  }
  yield* show(visibleText(text)); // a held-back partial fence that never became one
  for (const [index, c] of parseToolCalls(text).entries()) yield chunk({ tool_calls: [{ index, ...c }] });
  if (finish) yield chunk({}, finish);
}
