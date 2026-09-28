import type { ChatCompletionContentPartImage, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AgentEvent, AssistantMessage, ChatMessage, ToolCall } from '../shared/types';
import { dataUrl } from './attachments';
import { type Db, tx } from './db';
import { collect, describeLlmError, type Llm } from './llm';
import { systemPrompt } from './prompt';
import { addMessage, createAction, finishAction, getAction, getMessages, listActions } from './store';
import { findTool, parseArgs, toOpenAITools, type ToolCtx } from './tools';
import { errMsg } from './tools/common';

export const MAX_ROUNDS = 8;
const HISTORY = 20;

export type AgentDeps = {
  db: Db;
  ro: Db;
  attachmentsDir: string;
  now: () => Date;
  llm: () => Llm;
  emit: (e: AgentEvent) => void;
};

const ctxOf = (d: AgentDeps): ToolCtx => ({ db: d.db, ro: d.ro, now: d.now });

/** System prompt + roughly the last HISTORY messages, starting on a user message so tool replies never dangle. */
export function buildLlmMessages(deps: AgentDeps, conversationId: number): ChatCompletionMessageParam[] {
  const all = getMessages(deps.db, conversationId);
  let start = Math.max(0, all.length - HISTORY);
  while (start > 0 && all[start].role !== 'user') start--;
  const recent = all.slice(start);
  const lastUser = recent.map((m) => m.role).lastIndexOf('user');
  return [{ role: 'system', content: systemPrompt(deps.db, deps.now()) }, ...recent.map((m, i) => toLlm(deps, m, i === lastUser))];
}

/** Images go only with the latest user message (token cost); older ones stay as [ảnh #id] labels. */
function toLlm(deps: AgentDeps, m: ChatMessage, withImages: boolean): ChatCompletionMessageParam {
  if (m.role === 'assistant') return { role: 'assistant', content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
  const ids = m.attachment_ids ?? [];
  const text = [m.content, ids.map((id) => `[ảnh #${id}]`).join(' ')].filter(Boolean).join('\n');
  const images: ChatCompletionContentPartImage[] = withImages
    ? ids.flatMap((id) => {
        const url = dataUrl(deps.db, deps.attachmentsDir, id);
        return url ? [{ type: 'image_url' as const, image_url: { url } }] : [];
      })
    : [];
  return images.length ? { role: 'user', content: [{ type: 'text', text }, ...images] } : { role: 'user', content: text };
}

/** One user turn: stream, run read tools, loop. Returns early when write tools are parked for confirmation. */
export async function runTurn(deps: AgentDeps, conversationId: number, signal?: AbortSignal): Promise<void> {
  const tools = toOpenAITools();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const partial = { content: '' };
    let reply: AssistantMessage;
    try {
      const stream = deps.llm().stream({ messages: buildLlmMessages(deps, conversationId), tools, signal });
      reply = await collect(stream, (delta) => deps.emit({ type: 'text', conversationId, delta }), partial);
    } catch (e) {
      if (partial.content) addMessage(deps.db, conversationId, { role: 'assistant', content: `${partial.content}\n\n_(bị gián đoạn)_` });
      deps.emit(signal?.aborted ? { type: 'done', conversationId } : { type: 'error', conversationId, message: describeLlmError(e) });
      return;
    }
    if (signal?.aborted) {
      // Stop landed right as the stream ended: keep the text, drop the tool calls the user never saw run.
      if (reply.content) addMessage(deps.db, conversationId, { role: 'assistant', content: reply.content });
      deps.emit({ type: 'done', conversationId });
      return;
    }
    if (!reply.content && !reply.tool_calls?.length) {
      // An empty assistant message is invalid to replay to the API, so it is not saved.
      deps.emit({ type: 'error', conversationId, message: 'Mô hình không trả lời. Hãy thử lại.' });
      return;
    }
    addMessage(deps.db, conversationId, reply);
    deps.emit({ type: 'saved', conversationId });
    if (!reply.tool_calls?.length) {
      deps.emit({ type: 'done', conversationId });
      return;
    }
    let parked = false;
    for (const c of reply.tool_calls) parked = handleCall(deps, conversationId, c) || parked;
    if (parked) {
      deps.emit({ type: 'pending', conversationId });
      return;
    }
  }
  addMessage(deps.db, conversationId, {
    role: 'assistant',
    content: `Mình dừng lại vì yêu cầu này đã dùng quá ${MAX_ROUNDS} bước. Bạn thử chia nhỏ yêu cầu nhé.`,
  });
  deps.emit({ type: 'done', conversationId });
}

/** Runs a read tool now, or parks a write tool as a pending action. Returns true when parked. */
function handleCall(deps: AgentDeps, conversationId: number, c: ToolCall): boolean {
  const respond = (result: unknown): void =>
    void addMessage(deps.db, conversationId, { role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
  const tool = findTool(c.function.name);
  if (!tool) {
    respond({ error: `Không có tool ${c.function.name}` });
    return false;
  }
  let args: unknown;
  try {
    args = parseArgs(tool, JSON.parse(c.function.arguments || '{}'));
  } catch (e) {
    respond({ error: `Tham số không hợp lệ: ${errMsg(e)}` });
    return false;
  }
  if (tool.kind === 'read') {
    deps.emit({ type: 'tool', conversationId, name: tool.name });
    try {
      respond(tool.run(args, ctxOf(deps)));
    } catch (e) {
      respond({ error: errMsg(e) });
    }
    return false;
  }
  let preview: unknown = null;
  try {
    preview = tool.preview?.(args, ctxOf(deps)) ?? null;
  } catch (e) {
    respond({ error: errMsg(e) }); // e.g. unknown ids: tell the model instead of showing a broken card
    return false;
  }
  createAction(deps.db, { conversation_id: conversationId, tool_call_id: c.id, tool_name: tool.name, args, preview });
  return true;
}

/**
 * Confirms or cancels a parked write and answers its tool call.
 * Invalid (edited) args throw and leave the action pending so the user can fix them.
 * Returns true when no pending action is left, meaning the caller should resume the turn.
 */
export function resolveAction(deps: AgentDeps, actionId: number, decision: 'confirm' | 'cancel', editedArgs?: unknown): boolean {
  const action = getAction(deps.db, actionId);
  if (!action || action.status !== 'pending') throw new Error('Thao tác này đã được xử lý');
  const respond = (content: unknown): void =>
    void addMessage(deps.db, action.conversation_id, { role: 'tool', tool_call_id: action.tool_call_id, content: JSON.stringify(content) });

  if (decision === 'cancel') {
    tx(deps.db, () => {
      finishAction(deps.db, actionId, 'cancelled', action.args, null);
      respond({ cancelled: true, message: 'Người dùng đã hủy thao tác này' });
    });
  } else {
    const tool = findTool(action.tool_name);
    if (tool?.kind !== 'write') throw new Error(`Không có tool ghi ${action.tool_name}`);
    const args = parseArgs(tool, editedArgs ?? action.args);
    try {
      // One transaction: a committed write is always recorded as confirmed and answered, so a crash can't re-apply it.
      tx(deps.db, () => {
        const result = tool.apply(args, ctxOf(deps));
        finishAction(deps.db, actionId, 'confirmed', args, result);
        respond({ ok: true, result, ...(editedArgs ? { note: 'Người dùng đã chỉnh sửa trước khi xác nhận' } : {}) });
      });
    } catch (e) {
      tx(deps.db, () => {
        finishAction(deps.db, actionId, 'cancelled', args, { error: errMsg(e) });
        respond({ error: errMsg(e) });
      });
    }
  }
  return listActions(deps.db, action.conversation_id, 'pending').length === 0;
}

/** A new user message abandons unresolved actions, so every tool call is answered before the next user turn. */
export function cancelOpenActions(deps: AgentDeps, conversationId: number): void {
  for (const a of listActions(deps.db, conversationId, 'pending')) resolveAction(deps, a.id, 'cancel');
}
