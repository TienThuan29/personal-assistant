const OPEN = '<think>';
const CLOSE = '</think>';

/** The longest suffix of `s` that starts `tag`, so a tag cut between two chunks is held back instead of shown. */
function partialTag(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n;
  return 0;
}

/**
 * Splits streamed content into the answer and the `<think>…</think>` reasoning some local models write inline
 * (docs/pdf-batch-reasoning-design.md P12). Stateful: feed every chunk to `push`, then call `flush` when the stream ends.
 * Whitespace right after `</think>` is dropped so the answer does not start with blank lines.
 */
export function createThinkSplitter() {
  let thinking = false;
  let held = '';
  let trim = false;

  function push(chunk: string): { text: string; reasoning: string } {
    let buf = held + chunk;
    held = '';
    let text = '';
    let reasoning = '';
    for (;;) {
      if (trim) {
        buf = buf.trimStart();
        if (buf) trim = false;
      }
      if (!thinking) {
        const i = buf.indexOf(OPEN);
        if (i >= 0) {
          text += buf.slice(0, i);
          buf = buf.slice(i + OPEN.length);
          thinking = true;
          continue;
        }
        const keep = partialTag(buf, OPEN);
        text += buf.slice(0, buf.length - keep);
        held = buf.slice(buf.length - keep);
        break;
      }
      const i = buf.indexOf(CLOSE);
      if (i >= 0) {
        reasoning += buf.slice(0, i);
        buf = buf.slice(i + CLOSE.length);
        thinking = false;
        trim = true;
        continue;
      }
      const keep = partialTag(buf, CLOSE);
      reasoning += buf.slice(0, buf.length - keep);
      held = buf.slice(buf.length - keep);
      break;
    }
    return { text, reasoning };
  }

  /** What is still held back when the stream ends: a lone "<thi" was text after all. */
  function flush(): { text: string; reasoning: string } {
    const rest = held;
    held = '';
    return thinking ? { text: '', reasoning: rest } : { text: rest, reasoning: '' };
  }

  return { push, flush };
}
