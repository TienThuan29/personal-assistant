import type { ChatCompletionContentPartImage, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ASK_TOOL, type AgentEvent, type AskAnswer, type AskQuestion, type AskReply, type AssistantMessage, type ChatMessage, type ToolCall, type UiSettings } from '../shared/types';
import { dataUrl } from './attachments';
import { type Db, tx } from './db';
import { collect, describeLlmError, type Llm } from './llm';
import { systemPrompt } from './prompt';
import { addMessage, createAction, finishAction, getAction, getMessages, listActions } from './store';
import { findTool, parseArgs, TOOLS, toOpenAITools, type ToolCtx } from './tools';
import { ASK_LIMITS } from './tools/ask';
import { FILE_TOOLS, fileError, findFileTool } from './tools/files';
import { errMsg, te, UserError } from './errors';
import { BAD_BLOCK } from './gateway';

export const MAX_ROUNDS = 8;
const HISTORY = 20; // ponytail: history window walks back to the last user message; unbounded within one long confirm/resume turn

export type AgentDeps = {
  db: Db;
  ro: Db;
  attachmentsDir: string;
  now: () => Date;
  settings: () => UiSettings;
  llm: () => Llm;
  emit: (e: AgentEvent) => void;
  /** The folder the file tools may search and read. */
  home: string;
};

const ctxOf = (d: AgentDeps): ToolCtx => ({ db: d.db, ro: d.ro, now: d.now, settings: d.settings });

/**
 * System prompt + roughly the last HISTORY messages, starting on a user message so tool replies never dangle.
 * `textOnly`: the provider can't see images (G8), so none are attached and the labels say so. `files`: the file tools are on.
 */
export function buildLlmMessages(deps: AgentDeps, conversationId: number, textOnly = false, files = false): ChatCompletionMessageParam[] {
  const all = getMessages(deps.db, conversationId);
  let start = Math.max(0, all.length - HISTORY);
  while (start > 0 && all[start].role !== 'user') start--;
  const recent = all.slice(start);
  const lastUser = recent.map((m) => m.role).lastIndexOf('user');
  return [
    { role: 'system', content: systemPrompt(deps.db, deps.now(), deps.settings(), files) },
    ...recent.map((m, i) => toLlm(deps, m, i === lastUser && !textOnly, textOnly)),
  ];
}

/** Whether the latest user message turned on file search; it holds for the whole turn, also when it resumes after a card. */
const filesOn = (deps: AgentDeps, conversationId: number): boolean => {
  const last = getMessages(deps.db, conversationId).findLast((m) => m.role === 'user');
  return last?.role === 'user' && last.files === true;
};

/**
 * Runs the reply's file tool calls before its transaction: they are async and may take seconds. A call while file
 * access is off gets an error, so the model can never read files the user didn't allow for this message.
 */
async function runFileCalls(
  deps: AgentDeps,
  conversationId: number,
  calls: ToolCall[],
  allowed: boolean,
  signal?: AbortSignal
): Promise<Map<ToolCall, unknown>> {
  const out = new Map<ToolCall, unknown>();
  for (const c of calls) {
    const tool = findFileTool(c.function.name);
    if (!tool) continue;
    if (!allowed) {
      out.set(c, { error: te('fileAccessOff') });
      continue;
    }
    let args: unknown;
    try {
      args = parseArgs(tool, JSON.parse(c.function.arguments || '{}'));
    } catch (e) {
      out.set(c, { error: te('invalidArgs', { error: errMsg(e) }) });
      continue;
    }
    deps.emit({ type: 'tool', conversationId, name: c.function.name }); // shown while it runs
    try {
      out.set(c, await tool.run(args, { home: deps.home, signal })); // oxlint-disable-line no-await-in-loop -- one search at a time
    } catch (e) {
      out.set(c, { error: errMsg(fileError(e)) });
    }
  }
  return out;
}

/** Images go only with the latest user message (token cost); older ones stay as [ảnh #id] labels. */
function toLlm(deps: AgentDeps, m: ChatMessage, withImages: boolean, textOnly: boolean): ChatCompletionMessageParam {
  if (m.role === 'assistant') return { role: 'assistant', content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
  const ids = m.attachment_ids ?? [];
  const labels = ids.map((id) => `[ảnh #${id}]`).join(' ') + (textOnly && ids.length ? ' (this model cannot see images, only the labels)' : '');
  const text = [m.content, labels].filter(Boolean).join('\n');
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
  if (listActions(deps.db, conversationId, 'pending').length) {
    deps.emit({ type: 'pending', conversationId }); // unanswered tool calls would make the API reject the request
    return;
  }
  const files = filesOn(deps, conversationId);
  const tools = toOpenAITools(files ? [...TOOLS, ...FILE_TOOLS] : TOOLS);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const partial = { content: '' };
    let reply: AssistantMessage;
    try {
      const llm = deps.llm();
      const stream = llm.stream({ messages: buildLlmMessages(deps, conversationId, llm.textOnly, files), tools, signal });
      reply = await collect(stream, (delta) => deps.emit({ type: 'text', conversationId, delta }), partial);
    } catch (e) {
      if (partial.content) addMessage(deps.db, conversationId, { role: 'assistant', content: `${partial.content}\n\n_${te('interrupted')}_` });
      deps.emit(signal?.aborted ? { type: 'done', conversationId } : { type: 'error', conversationId, message: describeLlmError(e) });
      return;
    }
    const fileResults = signal?.aborted ? new Map() : await runFileCalls(deps, conversationId, reply.tool_calls ?? [], files, signal);
    if (signal?.aborted) {
      // Stop landed right as the stream ended: keep the text, drop the tool calls the user never saw run.
      if (reply.content) addMessage(deps.db, conversationId, { role: 'assistant', content: reply.content });
      deps.emit({ type: 'done', conversationId });
      return;
    }
    if (!reply.content && !reply.tool_calls?.length) {
      // An empty assistant message is invalid to replay to the API, so it is not saved.
      deps.emit({ type: 'error', conversationId, message: te('emptyReply') });
      return;
    }
    const calls = reply.tool_calls ?? [];
    // One transaction: a tool_calls message is never stored without its replies or parked actions.
    const outcomes = tx(deps.db, () => {
      const messageId = addMessage(deps.db, conversationId, reply);
      return calls.map((c) => handleCall(deps, conversationId, messageId, c, fileResults));
    });
    deps.emit({ type: 'saved', conversationId });
    calls.forEach((c, i) => outcomes[i] === 'ran' && deps.emit({ type: 'tool', conversationId, name: c.function.name }));
    if (!calls.length) {
      deps.emit({ type: 'done', conversationId });
      return;
    }
    if (outcomes.includes('parked')) {
      deps.emit({ type: 'pending', conversationId });
      return;
    }
  }
  addMessage(deps.db, conversationId, {
    role: 'assistant',
    content: te('maxRounds', { max: MAX_ROUNDS }),
  });
  deps.emit({ type: 'done', conversationId });
}

/**
 * Runs a read tool now ('ran'), parks a write tool as a pending action ('parked'), or answers with an error.
 * File tool calls already ran (runFileCalls); their results are only saved here.
 */
function handleCall(deps: AgentDeps, conversationId: number, messageId: number, c: ToolCall, fileResults: Map<ToolCall, unknown>): 'ran' | 'parked' | 'error' {
  const respond = (result: unknown): void =>
    void addMessage(deps.db, conversationId, { role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
  if (fileResults.has(c)) {
    respond(fileResults.get(c));
    return 'ran';
  }
  if (c.function.name === BAD_BLOCK) {
    respond({ error: te('badToolBlock') }); // a gateway reply whose tool_calls block didn't parse (G9)
    return 'error';
  }
  const tool = findTool(c.function.name);
  if (!tool || tool.kind === 'fs') {
    respond({ error: te('unknownTool', { name: c.function.name }) });
    return 'error';
  }
  let args: unknown;
  try {
    args = parseArgs(tool, JSON.parse(c.function.arguments || '{}'));
  } catch (e) {
    respond({ error: te('invalidArgs', { error: errMsg(e) }) });
    return 'error';
  }
  if (tool.kind === 'read') {
    try {
      respond(tool.run(args, ctxOf(deps)));
    } catch (e) {
      respond({ error: errMsg(e) });
    }
    return 'ran';
  }
  if (tool.kind === 'ask') {
    createAction(deps.db, { conversation_id: conversationId, message_id: messageId, tool_call_id: c.id, tool_name: tool.name, args, preview: null });
    return 'parked'; // answered from the card (answerAction), or by the user's next message (resolveAction 'cancel')
  }
  let preview: unknown = null;
  try {
    preview = tool.preview?.(args, ctxOf(deps)) ?? null;
  } catch (e) {
    respond({ error: errMsg(e) }); // e.g. unknown ids: tell the model instead of showing a broken card
    return 'error';
  }
  createAction(deps.db, { conversation_id: conversationId, message_id: messageId, tool_call_id: c.id, tool_name: tool.name, args, preview });
  return 'parked';
}

/**
 * Confirms or cancels a parked write and answers its tool call.
 * Invalid (edited) args throw and leave the action pending so the user can fix them.
 * Returns true when no pending action is left, meaning the caller should resume the turn.
 */
export function resolveAction(deps: AgentDeps, actionId: number, decision: 'confirm' | 'cancel', editedArgs?: unknown): boolean {
  const action = getAction(deps.db, actionId);
  if (!action || action.status !== 'pending') throw new UserError('actionResolved');
  const respond = (content: unknown): void =>
    void addMessage(deps.db, action.conversation_id, { role: 'tool', tool_call_id: action.tool_call_id, content: JSON.stringify(content) });

  if (decision === 'cancel') {
    const ask = action.tool_name === ASK_TOOL; // only ever closed this way by the user typing a message instead of answering
    tx(deps.db, () => {
      finishAction(deps.db, actionId, 'cancelled', action.args, ask ? { inChat: true } : null);
      respond(
        ask
          ? { skipped: true, note: 'The user did not pick on the card but answered in their next message' }
          : { cancelled: true, message: 'The user cancelled this action' }
      );
    });
  } else {
    const tool = findTool(action.tool_name);
    if (tool?.kind !== 'write') throw new UserError('unknownWriteTool', { name: action.tool_name });
    const args = parseArgs(tool, editedArgs ?? action.args);
    try {
      // One transaction: a committed write is always recorded as confirmed and answered, so a crash can't re-apply it.
      tx(deps.db, () => {
        const result = tool.apply(args, ctxOf(deps));
        finishAction(deps.db, actionId, 'confirmed', args, result);
        respond({ ok: true, result, ...(editedArgs ? { note: 'The user edited the values before confirming' } : {}) });
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

/** The replies as answers, or a throw: one per question, picks drawn from its options, one pick at most unless `multiple`, never empty. */
function checkReplies(questions: AskQuestion[], replies: unknown): AskAnswer[] {
  if (!Array.isArray(replies) || replies.length !== questions.length) throw new UserError('invalidAnswer');
  return questions.map((q, i) => {
    const r = replies[i] as Partial<AskReply> | null;
    const picked = r?.picked;
    const other = typeof r?.other === 'string' ? r.other.trim() : '';
    if (!Array.isArray(picked) || other.length > ASK_LIMITS.other) throw new UserError('invalidAnswer');
    const count = picked.length + (other ? 1 : 0);
    const valid = picked.every((p) => q.options.includes(p)) && new Set(picked).size === picked.length;
    if (!valid || count === 0 || (!q.multiple && count > 1)) throw new UserError('invalidAnswer');
    return { question: q.question, picked, ...(other ? { other } : {}) };
  });
}

/**
 * Answers a parked ask_user card and answers its tool call with the replies. Invalid replies throw and leave it pending.
 * Returns true when no pending action is left, meaning the caller should resume the turn.
 */
export function answerAction(deps: AgentDeps, actionId: number, replies: unknown): boolean {
  const action = getAction(deps.db, actionId);
  if (!action || action.status !== 'pending') throw new UserError('actionResolved');
  if (action.tool_name !== ASK_TOOL) throw new UserError('invalidAnswer');
  const answers = checkReplies((action.args as { questions: AskQuestion[] }).questions, replies);
  tx(deps.db, () => {
    finishAction(deps.db, actionId, 'confirmed', action.args, { answers });
    addMessage(deps.db, action.conversation_id, { role: 'tool', tool_call_id: action.tool_call_id, content: JSON.stringify({ answers }) });
  });
  return listActions(deps.db, action.conversation_id, 'pending').length === 0;
}

/** A new user message abandons unresolved actions, so every tool call is answered before the next user turn. */
export function cancelOpenActions(deps: AgentDeps, conversationId: number): void {
  for (const a of listActions(deps.db, conversationId, 'pending')) resolveAction(deps, a.id, 'cancel');
}
