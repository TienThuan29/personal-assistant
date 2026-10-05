import { Bell, BookOpen, CircleCheck, Languages, MessageSquare, Moon, NotebookPen, Search, Settings, Sun, Wallet, Zap } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterPalette } from '../../shared/palette';
import type { ConversationRow, NoteRow, Page, TaskRow } from '../../shared/types';
import { api } from '../api';
import { shortcutLabel } from '../shortcuts';
import { ICON, Kbd } from './ui';

export type PaletteActions = {
  go: (page: Page) => void;
  newChat: () => void;
  capture: () => void;
  add: (kind: 'task' | 'expense' | 'reminder' | 'note') => void;
  openTask: (task: TaskRow) => void;
  openNote: (id: number) => void;
  openChat: (id: number) => void;
  toggleTheme: () => void;
  toggleLanguage: () => void;
  welcome: () => void;
};

type Item = { id: string; label: string; icon: ReactNode; hint?: string; run: () => void };
type Group = { label: string; items: Item[] };

/** ⌘K (docs/ui-redesign-design.md): jump to a page, run an action, or find a task, note or chat, from anywhere. */
export function Palette({
  actions,
  conversations,
  titleOf,
  dark,
  mac,
  onClose,
}: {
  actions: PaletteActions;
  conversations: ConversationRow[];
  titleOf: (c: ConversationRow) => string;
  dark: boolean;
  mac: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['shell', 'common', 'pages', 'chat']);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const k = (key: string) => shortcutLabel(key, mac);
  const q = query.trim();

  // Tasks and notes come from the data tools, only once there is something to look for.
  useEffect(() => {
    if (!q) {
      setTasks([]);
      setNotes([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api.data.read<TaskRow[]>('list_tasks', { query: q, status: 'todo' }).then((r) => live && setTasks(r), () => {});
      void api.data.read<NoteRow[]>('search_notes', { query: q, limit: 20 }).then((r) => live && setNotes(r), () => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const groups: Group[] = useMemo(() => {
    const ic = (n: ReactNode) => n;
    const act = (id: string, label: string, icon: ReactNode, run: () => void, hint?: string): Item => ({ id, label, icon: ic(icon), run, hint });
    const pageItems: Item[] = (
      [
        ['today', <Sun key='a' {...ICON} />, '1'],
        ['tasks', <CircleCheck key='b' {...ICON} />, '2'],
        ['notes', <NotebookPen key='c' {...ICON} />, '3'],
        ['expenses', <Wallet key='d' {...ICON} />, '4'],
        ['reminders', <Bell key='e' {...ICON} />, '5'],
        ['settings', <Settings key='f' {...ICON} />, ','],
      ] as const
    ).map(([p, icon, key]) => act(`page:${p}`, t(`common:nav.${p}`), icon, () => actions.go(p), k(key)));
    const actionItems: Item[] = [
      act('a:chat', t('chat:newChat'), <MessageSquare {...ICON} />, actions.newChat, k('N')),
      act('a:capture', t('shell:capture'), <Zap {...ICON} />, actions.capture, k('J')),
      act('a:task', t('pages:addTask'), <CircleCheck {...ICON} />, () => actions.add('task')),
      act('a:expense', t('pages:addExpense'), <Wallet {...ICON} />, () => actions.add('expense')),
      act('a:reminder', t('pages:addReminder'), <Bell {...ICON} />, () => actions.add('reminder')),
      act('a:note', t('pages:addNote'), <NotebookPen {...ICON} />, () => actions.add('note')),
      act('a:theme', t('shell:toggleTheme'), dark ? <Sun {...ICON} /> : <Moon {...ICON} />, actions.toggleTheme),
      act('a:lang', i18n.language === 'en' ? 'Chuyển sang Tiếng Việt' : 'Switch to English', <Languages {...ICON} />, actions.toggleLanguage),
      act('a:welcome', t('shell:openWelcome'), <BookOpen {...ICON} />, actions.welcome),
    ];
    const found: Item[] = !q
      ? []
      : [
          ...tasks.map((x) => act(`task:${x.id}`, x.title, <CircleCheck {...ICON} />, () => actions.openTask(x), t('shell:type.task'))),
          ...notes.map((n) => act(`note:${n.id}`, n.title || t('pages:untitled'), <NotebookPen {...ICON} />, () => actions.openNote(n.id), t('shell:type.note'))),
          ...conversations
            .filter((c) => c.title)
            .map((c) => act(`chat:${c.id}`, titleOf(c), <MessageSquare {...ICON} />, () => actions.openChat(c.id), t('shell:type.chat'))),
        ];
    const all: Group[] = [
      { label: t('shell:palActions'), items: actionItems },
      { label: t('shell:palGo'), items: pageItems },
      { label: t('shell:palItems'), items: found },
    ].map((g) => ({ ...g, items: filterPalette(g.items, q) }));
    // With a query the things found come first: that is what the user is most likely after.
    const shown = all.filter((g) => g.items.length);
    return q ? [...shown].sort((a, b) => Number(b.label === t('shell:palItems')) - Number(a.label === t('shell:palItems'))) : shown;
  }, [q, tasks, notes, conversations, titleOf, dark, mac, i18n.language, t, actions]);

  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(sel, Math.max(0, flat.length - 1));
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [current, flat.length]);

  const run = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(1, flat.length);
      setSel((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[current]);
    }
  };

  let index = 0;
  return (
    <div
      role='presentation'
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
      className='fixed inset-0 z-[1500] flex items-start justify-center pt-[12vh]'
      style={{ background: 'rgba(10,10,12,.28)', backdropFilter: 'blur(2px)' }}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('shell:palette')}
        className='w-[min(620px,92%)] overflow-hidden bg-panel border border-solid border-line rounded-[14px] shadow-lg'
        style={{ animation: 'pa-pop .18s ease-out' }}
      >
        <div className='flex items-center gap-2.5 px-4 border-b border-b-solid border-line'>
          <span aria-hidden className='flex text-[17px] text-ink-3'>
            <Search {...ICON} />
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t('shell:palPlaceholder')}
            aria-label={t('shell:palette')}
            role='combobox'
            aria-expanded='true'
            aria-controls='palette-list'
            className='flex-1 h-[52px] border-0 bg-transparent outline-none text-[15.5px]'
          />
          <Kbd className='px-1.5 py-0.5 border border-solid border-line rounded'>Esc</Kbd>
        </div>
        <div ref={list} id='palette-list' role='listbox' className='max-h-[min(420px,56vh)] overflow-y-auto p-1.5'>
          {!flat.length && <div className='p-7 text-center text-[13px] text-ink-3'>{t('shell:palEmpty')}</div>}
          {groups.map((g) => (
            <div key={g.label}>
              <div className='px-2.5 pt-2.5 pb-1 text-[11px] font-600 tracking-[0.04em] uppercase text-ink-3'>{g.label}</div>
              {g.items.map((it) => {
                const i = index++;
                const on = i === current;
                return (
                  <button
                    key={it.id}
                    type='button'
                    role='option'
                    aria-selected={on}
                    onClick={() => run(it)}
                    onMouseMove={() => sel !== i && setSel(i)}
                    className={`w-full h-[38px] flex items-center gap-3 px-2.5 border-0 rounded-lg text-left text-sm cursor-pointer ${on ? 'bg-accent-soft' : 'bg-transparent'}`}
                  >
                    <span aria-hidden className={`flex text-base ${on ? 'text-accent' : 'text-ink-3'}`}>{it.icon}</span>
                    <span className='flex-1 min-w-0 truncate'>{it.label}</span>
                    {it.hint && <span className='font-mono text-[11px] text-ink-3'>{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className='flex gap-4 px-4 py-2 border-t border-t-solid border-line bg-sunken text-[11.5px] text-ink-3'>
          <span>↑↓ {t('shell:palNavigate')}</span>
          <span>↵ {t('shell:palOpen')}</span>
          <span>Esc {t('shell:palClose')}</span>
        </div>
      </div>
    </div>
  );
}
