import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import { z } from 'zod/v4';
import { askTools } from './ask';
import { type Tool, tr } from './common';
import { expenseTools } from './expenses';
import { noteTools } from './notes';
import { overviewTools } from './overview';
import { reminderTools } from './reminders';
import { sqlTools } from './sql';
import { taskTools } from './tasks';

export type { Tool, ToolCtx } from './common';

export const TOOLS: Tool[] = [...overviewTools, ...taskTools, ...reminderTools, ...noteTools, ...expenseTools, ...sqlTools, ...askTools];

export const findTool = (name: string): Tool | undefined => TOOLS.find((t) => t.name === name);

/** Validates LLM (or UI) args against the tool's schema; the error text goes back to the model. */
export function parseArgs(tool: Tool, raw: unknown): unknown {
  const r = tool.schema.safeParse(raw);
  if (!r.success) {
    for (const issue of r.error.issues) issue.message = tr(issue.message); // schema messages are 'errors:' keys
    throw new Error(z.prettifyError(r.error));
  }
  return r.data;
}

export function toOpenAITools(): ChatCompletionFunctionTool[] {
  return TOOLS.map((t) => {
    // io: 'input' keeps fields with .default() optional for the model.
    const { $schema: _drop, ...parameters } = z.toJSONSchema(t.schema, { io: 'input' }) as Record<string, unknown>;
    return { type: 'function', function: { name: t.name, description: t.description, parameters } };
  });
}
