// The loop behind a PDF message (docs/pdf-batch-reasoning-design.md P3/P4/P7/P8): one turn per batch of pages, then a turn
// that combines the notes. Every path that starts a turn (send, retry, resume after a card) comes through here.
import { batchRanges } from '../shared/pdf';
import type { AgentEvent } from '../shared/types';
import { type AgentDeps, runTurn } from './agent';
import { batchPrompt, finalPrompt, nextStep, questionOf } from './documents';
import { addMessage, getMessages } from './store';

type Outcome = 'done' | 'error' | 'pending' | 'aborted';

/**
 * Runs one turn and reports how it ended. Events pass through, except `done` of a turn that is not the last one: the UI would
 * take it for the end of the whole run.
 */
async function runPart(deps: AgentDeps, conversationId: number, signal: AbortSignal | undefined, o: { tools: boolean; last: boolean }): Promise<Outcome> {
  let outcome: Outcome = 'done';
  const emit = (e: AgentEvent) => {
    if (e.type === 'error') outcome = 'error';
    else if (e.type === 'pending') outcome = 'pending';
    if (e.type === 'done' && !o.last) return;
    deps.emit(e);
  };
  await runTurn({ ...deps, emit }, conversationId, signal, { tools: o.tools });
  return signal?.aborted && outcome === 'done' ? 'aborted' : outcome;
}

/** Whether the model can read the PDF's pages; a model that cannot (the gateway) gets the PDF message alone. */
function seesImages(deps: AgentDeps): boolean {
  try {
    return !deps.llm().textOnly;
  } catch {
    return true; // not configured: let the turn report that itself
  }
}

export async function runWithDocuments(deps: AgentDeps, conversationId: number, signal?: AbortSignal): Promise<void> {
  const { db, emit } = deps;
  for (;;) {
    const msgs = getMessages(db, conversationId);
    const step = nextStep(msgs);
    if (step.kind === 'normal' || !seesImages(deps)) return runTurn(deps, conversationId, signal);
    if (signal?.aborted) return emit({ type: 'done', conversationId });

    const doc = msgs.findLast((m) => m.role === 'user' && m.document);
    const pdf = doc?.role === 'user' ? doc.document! : null;
    if (!pdf) return runTurn(deps, conversationId, signal); // unreachable: nextStep found a document
    const question = questionOf(msgs);
    const ranges = batchRanges(pdf.pages.length);

    // `rerun` reuses the last message; the others add the next one.
    let last = msgs[msgs.length - 1];
    if (step.kind === 'batch') {
      const { from, to } = ranges[step.part - 1];
      const batch = { name: pdf.name, part: step.part, parts: step.parts, from, to, total: pdf.pages.length };
      addMessage(db, conversationId, { role: 'user', content: batchPrompt(batch, question), attachment_ids: pdf.pages.slice(from - 1, to), batch });
    } else if (step.kind === 'final') {
      addMessage(db, conversationId, { role: 'user', content: finalPrompt(pdf.name, ranges.length, question), final: true });
    }
    last = getMessages(db, conversationId).at(-1)!;
    if (last.role !== 'user') return runTurn(deps, conversationId, signal);

    const isFinal = !!last.final;
    const b = last.batch;
    emit({
      type: 'progress',
      conversationId,
      phase: isFinal ? 'final' : 'batch',
      part: b?.part ?? ranges.length,
      parts: ranges.length,
      from: b?.from ?? 1,
      to: b?.to ?? pdf.pages.length,
      total: pdf.pages.length,
    });
    const outcome = await runPart(deps, conversationId, signal, { tools: isFinal, last: isFinal });
    if (isFinal) return;
    if (outcome === 'aborted') return emit({ type: 'done', conversationId });
    if (outcome !== 'done') return; // the error (or card) was already emitted; Retry continues from here
  }
}
