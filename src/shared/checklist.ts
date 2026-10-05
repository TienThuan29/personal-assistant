type Block = { kind: 'md'; text: string } | { kind: 'todo'; line: number; done: boolean; text: string };

const TODO = /^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/;

/** Splits a note into Markdown runs and checklist lines (`- [ ] item`), so the checklist can be ticked from the preview. */
export function blocksOf(body: string): Block[] {
  const blocks: Block[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.join('').trim()) blocks.push({ kind: 'md', text: run.join('\n') });
    run = [];
  };
  body.split('\n').forEach((text, line) => {
    const m = TODO.exec(text);
    if (m) {
      flush();
      blocks.push({ kind: 'todo', line, done: m[2] !== ' ', text: m[3] });
    } else run.push(text);
  });
  flush();
  return blocks;
}

/** The body with the checklist item on `line` flipped. */
export function toggleTodo(body: string, line: number): string {
  const lines = body.split('\n');
  lines[line] = lines[line].replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

