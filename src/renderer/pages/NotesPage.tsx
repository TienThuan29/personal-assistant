import { Eye, Notebook, PenLine, Pencil, Plus, Search, SquareSplitHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Btn, Chip, EmptyState, ICON, IconBtn, Segmented } from '../components/ui';
import { NoteBody } from '../components/NoteBody';
import { Skeleton, useData } from '../useData';
import { NoteForm } from './NoteForm';

/** Renders the ⟦match⟧ markers from FTS snippets as <mark>. */
const highlight = (s: string) => s.split(/[⟦⟧]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));

type Mode = 'write' | 'split' | 'preview';

/** Notes as the design has them: the list and search on the left, the open note on the right, written as Markdown with a live preview. */
export function NotesPage({ initialNoteId }: { initialNoteId?: number }) {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState<NoteRow | null>(null); // the form, for what the editor does not show: the kind and the images
  const [openId, setOpenId] = useState<number | null>(initialNoteId ?? null);
  const [note, setNote] = useState<NoteRow | null>(null); // the open note with its full body
  const [mode, setMode] = useState<Mode>('split');
  const read = useCallback(() => api.data.read<NoteRow[]>('search_notes', { query: query.trim() || undefined, limit: 100 }), [query]);
  const { data: notes, loading, busy, remove, fail, holders } = useData(read, [], query ? 250 : 0); // debounce typing

  // Open the first note when there is none open, or the open one has gone.
  useEffect(() => {
    if (loading) return;
    if (openId === null || (!notes.some((n) => n.id === openId) && !query)) setOpenId(notes[0]?.id ?? null);
  }, [notes, loading, openId, query]);

  // Search rows carry a snippet; the open note needs its full body (get_notes) and is edited in place.
  const loaded = useRef(0);
  useEffect(() => {
    if (openId === null) return setNote(null);
    const seq = ++loaded.current;
    void api.data.read<NoteRow[]>('get_notes', { ids: [openId] }).then((r) => seq === loaded.current && setNote(r[0] ?? null), fail);
  }, [openId, notes]); // reloaded when the list changes: an edit, a delete, a change from the chat

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [draft, setDraft] = useState<{ id: number; title: string; body: string } | null>(null);
  useEffect(() => {
    if (note && draft?.id !== note.id) setDraft({ id: note.id, title: note.title ?? '', body: note.body ?? '' });
  }, [note]);

  /** Saves a second after the last key, so typing is never interrupted and nothing is lost on a quick switch. */
  const edit = (patch: { title?: string; body?: string }) => {
    if (!draft || !note) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    clearTimeout(saveTimer.current);
    const id = note.id;
    saveTimer.current = setTimeout(() => {
      if (!next.body.trim()) return; // a note needs a body; the form's own rule
      api.data.save('update_notes', { ids: [id], patch: { title: next.title, body: next.body } }).catch(fail);
    }, 900);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const words = useMemo(() => (draft?.body.trim() ? draft.body.trim().split(/\s+/).length : 0), [draft?.body]);
  const when = (iso: string) => new Date(iso).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const stamp = (iso: string) => new Date(iso).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'write';

  return (
    <div className='flex-1 min-w-0 grid [grid-template-columns:minmax(220px,280px)_minmax(0,1fr)]'>
      {holders}
      <div className='flex flex-col min-h-0 bg-sunken border-r border-r-solid border-line'>
        <div className='flex flex-col gap-2.5 px-3.5 pt-4 pb-2.5'>
          <div className='flex items-center gap-2'>
            <h1 className='m-0 flex-1 text-lg font-600'>{t('common:nav.notes')}</h1>
            <button
              type='button'
              aria-label={t('addNote')}
              title={t('addNote')}
              onClick={() => setAdding(true)}
              className='grid place-items-center w-[30px] h-[30px] border-0 rounded-lg bg-accent text-accent-on text-base cursor-pointer hover:brightness-110'
            >
              <Plus {...ICON} />
            </button>
          </div>
          <label className='flex items-center gap-2 h-[34px] px-2.5 border border-solid border-line rounded-lg bg-panel focus-within:border-accent'>
            <span aria-hidden className='flex text-ink-3'>
              <Search {...ICON} />
            </span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchNotes')} aria-label={t('searchNotes')} className='flex-1 min-w-0 border-0 bg-transparent outline-none text-[13px]' />
          </label>
        </div>
        <div className='flex-1 min-h-0 overflow-y-auto px-2 pt-0.5 pb-3 flex flex-col gap-0.5'>
          {loading && <Skeleton />}
          {!loading && !notes.length && <div className='p-6 text-center text-[13px] text-ink-3'>{query.trim() ? t('noNotesFound') : t('noNotes')}</div>}
          {notes.map((n) => {
            const on = n.id === openId;
            const title = n.title || t('untitled');
            return (
              <button
                key={n.id}
                type='button'
                aria-current={on ? 'true' : undefined}
                disabled={busy.includes(n.id)}
                onClick={() => setOpenId(n.id)}
                className={`flex flex-col gap-1 px-3 py-2.5 rounded-[9px] border border-solid text-left cursor-pointer ${on ? 'bg-accent-soft border-accent-line' : 'border-transparent bg-transparent hover:bg-hover'}`}
              >
                <div className='flex items-center gap-1.5 w-full'>
                  <span className='flex-1 min-w-0 font-600 text-[13.5px] truncate'>{title}</span>
                  <span className='text-[11.5px] text-ink-3 whitespace-nowrap'>{new Date(n.created_at).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'vi-VN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <div className='w-full text-[12.5px] text-ink-2 line-clamp-2'>{highlight(n.snippet ?? '')}</div>
                {n.kind === 'journal' && (
                  <span className='self-start'>
                    <Chip tone='accent'>{t('journal')}</Chip>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {note && draft ? (
        <div className='flex flex-col min-w-0 min-h-0'>
          <div className='flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-b-solid border-line'>
            <Chip>{note.kind === 'journal' ? t('journal') : t('noteKind')}</Chip>
            <span className='flex-1 min-w-0 text-xs text-ink-3 truncate'>
              {t('edited', { when: stamp(note.updated_at) })} · {t('words', { count: words })} · {when(note.created_at)}
            </span>
            <Segmented
              label={t('editorMode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'write', label: t('write'), icon: <PenLine {...ICON} /> },
                { value: 'split', label: t('split'), icon: <SquareSplitHorizontal {...ICON} /> },
                { value: 'preview', label: t('preview'), icon: <Eye {...ICON} /> },
              ]}
            />
            <IconBtn label={t('editNoteLabel', { what: draft.title || t('untitled') })} icon={<Pencil {...ICON} />} onClick={() => setDetails(note)} />
            <IconBtn
              label={t('deleteNote', { what: draft.title || t('untitled') })}
              icon={<Trash2 {...ICON} />}
              onClick={() => remove(note.id, 'delete_notes', draft.title || draft.body.slice(0, 60))}
              className='hover:!bg-danger-soft hover:!text-danger'
            />
          </div>
          <div className='flex-1 min-h-0 flex'>
            {showEditor && (
              <div className={`flex-1 min-w-0 flex flex-col ${showPreview ? 'border-r border-r-solid border-line' : ''}`}>
                <input
                  value={draft.title}
                  onChange={(e) => edit({ title: e.target.value })}
                  placeholder={t('untitled')}
                  aria-label={t('noteTitle')}
                  className='border-0 outline-none bg-transparent text-[22px] font-600 tracking-[-0.015em] px-7 pt-6 pb-2'
                />
                <textarea
                  value={draft.body}
                  onChange={(e) => edit({ body: e.target.value })}
                  spellCheck={false}
                  aria-label={t('noteBody')}
                  className='flex-1 min-h-0 border-0 outline-none resize-none bg-transparent px-7 pt-1 pb-7 font-mono text-[13.5px] leading-[1.75] text-ink'
                />
              </div>
            )}
            {showPreview && (
              <div className='flex-1 min-w-0 overflow-y-auto px-8 pt-6 pb-10 bg-panel'>
                <div className='max-w-[640px] mx-auto flex flex-col gap-2'>
                  {!showEditor && <h2 className='m-0 mb-1 text-2xl font-600 tracking-[-0.02em]'>{draft.title || t('untitled')}</h2>}
                  <NoteBody
                    text={draft.body}
                    onToggle={(body) => edit({ body })}
                  />
                  <Thumbs ids={note.attachment_ids} />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className='grid place-items-center'>
          {!loading && !notes.length ? (
            <EmptyState icon={<Notebook {...ICON} />} title={query.trim() ? t('noNotesFound') : t('noNotes')} hint={query.trim() ? undefined : t('noNotesHint')}>
              {!query.trim() && (
                <Btn variant='primary' icon={<Plus {...ICON} />} onClick={() => setAdding(true)}>
                  {t('addNote')}
                </Btn>
              )}
            </EmptyState>
          ) : (
            <span className='text-[13px] text-ink-3'>{t('pickNote')}</span>
          )}
        </div>
      )}
      {adding && <NoteForm note={null} onClose={() => setAdding(false)} />}
      {details && <NoteForm key={details.id} note={details} onClose={() => setDetails(null)} />}
    </div>
  );
}
