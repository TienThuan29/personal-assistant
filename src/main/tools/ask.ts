import { z } from 'zod/v4';
import { ASK_TOOL } from '../../shared/types';
import { askTool } from './common';

export const ASK_LIMITS = { questions: 4, options: 4, question: 200, option: 80, other: 500 } as const;

const question = z.object({
  question: z.string().trim().min(1).max(ASK_LIMITS.question).describe('The question, short, in the same language as the user'),
  options: z
    .array(z.string().trim().min(1).max(ASK_LIMITS.option))
    .max(ASK_LIMITS.options)
    .default([])
    .describe('0-4 likely options, each a short phrase (may include an ID, e.g. "#12 Team meeting 9am"). Leave empty for an open question. Do NOT add "Other" yourself'),
  multiple: z.boolean().default(false).describe('true if several options may be picked at once'),
});

export const askTools = [
  askTool({
    name: ASK_TOOL,
    description:
      'Ask the user when required information is missing, the request is ambiguous (e.g. several records match), there are several possible readings, or a free-form answer is needed. Shows a card with the options and always an "Other" text box; the result is the user\'s answer. Put all questions (max 4) in one call. Only ask when really needed.',
    schema: z.object({ questions: z.array(question).min(1).max(ASK_LIMITS.questions) }),
  }),
];
