import { createThinkSplitter } from '../src/main/think';

/** Feeds the chunks and returns everything split out, flush included. */
function run(chunks: string[]) {
  const s = createThinkSplitter();
  let text = '';
  let reasoning = '';
  for (const c of [...chunks.map((x) => s.push(x)), s.flush()]) {
    text += c.text;
    reasoning += c.reasoning;
  }
  return { text, reasoning };
}

describe('createThinkSplitter', () => {
  it('passes plain text through', () => {
    expect(run(['Xin ', 'chào'])).toEqual({ text: 'Xin chào', reasoning: '' });
  });

  it('splits an inline think block from the answer and drops the blank lines after it', () => {
    expect(run(['<think>Để xem…</think>\n\nĐây là câu trả lời'])).toEqual({ text: 'Đây là câu trả lời', reasoning: 'Để xem…' });
  });

  it('copes with tags cut between chunks, even one character at a time', () => {
    const whole = 'a<think>nghĩ</think>\n\nb';
    expect(run([...whole])).toEqual({ text: 'ab', reasoning: 'nghĩ' });
    expect(run(['a<thi', 'nk>nghĩ</th', 'ink>b'])).toEqual({ text: 'ab', reasoning: 'nghĩ' });
  });

  it('streams the reasoning while it is still open and keeps an unclosed block as reasoning', () => {
    const s = createThinkSplitter();
    expect(s.push('<think>đang ')).toEqual({ text: '', reasoning: 'đang ' });
    expect(s.push('nghĩ')).toEqual({ text: '', reasoning: 'nghĩ' });
    expect(s.flush()).toEqual({ text: '', reasoning: '' });
  });

  it('treats a lone "<thi" at the very end as ordinary text', () => {
    expect(run(['so sánh a <thi'])).toEqual({ text: 'so sánh a <thi', reasoning: '' });
  });

  it('handles several blocks and a "<" that is not a tag', () => {
    expect(run(['1 < 2 <think>x</think> ok <think>y</think>done'])).toEqual({ text: '1 < 2 ok done', reasoning: 'xy' });
  });
});
