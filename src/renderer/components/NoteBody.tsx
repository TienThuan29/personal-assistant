import { Markdown } from '@aionui/ui/markdown';
import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { blocksOf, toggleTodo } from '../../shared/checklist';
import { ICON } from './ui';

/** A note rendered: Markdown (the app's renderer, so tables, code and math work too) with tickable checklists. */
export function NoteBody({ text, onToggle }: { text: string; onToggle: (body: string) => void }) {
  const blocks = useMemo(() => blocksOf(text), [text]);
  return (
    <div className='flex flex-col gap-1.5'>
      {blocks.map((b, i) =>
        b.kind === 'md' ? (
          <Markdown key={i}>{b.text}</Markdown>
        ) : (
          <button
            key={i}
            type='button'
            role='checkbox'
            aria-checked={b.done}
            onClick={() => onToggle(toggleTodo(text, b.line))}
            className={`flex items-center gap-2.5 py-0.5 border-0 bg-transparent text-left text-[14.5px] cursor-pointer ${b.done ? 'text-ink-3 line-through' : 'text-ink'}`}
          >
            <span className={`grid place-items-center w-4 h-4 shrink-0 rounded-[5px] border-[1.6px] border-solid text-[11px] ${b.done ? 'border-accent bg-accent text-accent-on' : 'border-ink-3'}`}>
              {b.done && <Check {...ICON} strokeWidth={3} />}
            </span>
            {b.text}
          </button>
        )
      )}
    </div>
  );
}
