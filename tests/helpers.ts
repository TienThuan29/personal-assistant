import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { AgentDeps } from '../src/main/agent';
import { openDb } from '../src/main/db';
import type { Llm } from '../src/main/llm';
import { findTool, parseArgs, type ToolCtx } from '../src/main/tools';
import type { AgentEvent, AssistantMessage } from '../src/shared/types';

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'pa-test-'));

/** A file-backed DB (so a read-only second connection can see it) plus that read-only connection. */
export function testDb() {
  const dir = tempDir();
  const path = join(dir, 'test.db');
  const db = openDb(path);
  const ro = new DatabaseSync(path, { readOnly: true });
  return { dir, path, db, ro };
}

/** 2026-09-28 09:00 local, a Monday. */
export const NOW = new Date(2026, 8, 28, 9, 0);

export function testCtx(now: () => Date = () => NOW): ToolCtx & { dir: string } {
  const { db, ro, dir } = testDb();
  return { db, ro, now, dir };
}

/** Parses args like the agent does, then runs (read) or applies (write) the tool. */
export function callTool<T = unknown>(ctx: ToolCtx, name: string, args: object): T {
  const tool = findTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const parsed = parseArgs(tool, args);
  return (tool.kind === 'read' ? tool.run(parsed, ctx) : tool.apply(parsed, ctx)) as T;
}

export const chunk = (delta: object): ChatCompletionChunk =>
  ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta, finish_reason: null }] }) as unknown as ChatCompletionChunk;

/** Streams one scripted assistant message per LLM call; tool-call arguments arrive split in two chunks. */
export function fakeLlm(script: AssistantMessage[]): Llm {
  let i = 0;
  return {
    async *stream() {
      const m = script[i++];
      if (!m) throw new Error('fake LLM script exhausted');
      if (m.content) yield chunk({ content: m.content });
      for (const [index, tc] of (m.tool_calls ?? []).entries()) {
        const args = tc.function.arguments;
        const half = Math.floor(args.length / 2);
        yield chunk({ tool_calls: [{ index, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: args.slice(0, half) } }] });
        yield chunk({ tool_calls: [{ index, function: { arguments: args.slice(half) } }] });
      }
    },
  };
}

export const say = (content: string): AssistantMessage => ({ role: 'assistant', content });
export const call = (id: string, name: string, args: object): AssistantMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

export function testDeps(script: AssistantMessage[], llm: Llm = fakeLlm(script)): AgentDeps & { events: AgentEvent[] } {
  const { db, ro, dir } = testDb();
  const events: AgentEvent[] = [];
  return { db, ro, attachmentsDir: join(dir, 'att'), now: () => NOW, llm: () => llm, emit: (e) => void events.push(e), events };
}
