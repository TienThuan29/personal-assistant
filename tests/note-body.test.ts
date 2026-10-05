import { blocksOf, toggleTodo } from '../src/shared/checklist';

const note = '# Đà Lạt\n\n- [x] Warm jacket\n- [ ] Rain poncho\n\n> Book the homestay\n- [ ] Hiking shoes';

describe('note checklists', () => {
  it('splits Markdown runs from checklist lines and keeps their line numbers', () => {
    expect(blocksOf(note)).toEqual([
      { kind: 'md', text: '# Đà Lạt\n' },
      { kind: 'todo', line: 2, done: true, text: 'Warm jacket' },
      { kind: 'todo', line: 3, done: false, text: 'Rain poncho' },
      { kind: 'md', text: '\n> Book the homestay' },
      { kind: 'todo', line: 6, done: false, text: 'Hiking shoes' },
    ]);
  });

  it('ticks and unticks one line, leaving the rest as it is', () => {
    const ticked = toggleTodo(note, 3);
    expect(ticked.split('\n')[3]).toBe('- [x] Rain poncho');
    expect(toggleTodo(ticked, 3)).toBe(note);
    expect(toggleTodo(note, 2).split('\n')[2]).toBe('- [ ] Warm jacket');
  });

  it('has no blocks for an empty note and does not take a plain bullet for a task', () => {
    expect(blocksOf('')).toEqual([]);
    expect(blocksOf('- not a task')).toEqual([{ kind: 'md', text: '- not a task' }]);
  });
});
