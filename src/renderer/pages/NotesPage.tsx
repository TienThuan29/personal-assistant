import { AionSearchInput } from '@aionui/ui';
import { Button } from '@arco-design/web-react';
import { Delete, Edit, Notes, Plus, Search } from '@icon-park/react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Chip, EmptyState, PageToolbar } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { NoteForm } from './NoteForm';

/** Renders the ⟦match⟧ markers from FTS snippets as <mark>. */
const highlight = (s: string) => s.split(/[⟦⟧]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));

const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function NotesPage() {
  const { t } = useTranslation(['pages', 'common']);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<NoteRow | null>(); // undefined: closed, null: adding
  const read = useCallback(() => api.data.read<NoteRow[]>('search_notes', { query: query.trim() || undefined, limit: 100 }), [query]);
  const { data: notes, loading, busy, remove, fail, holders } = useData(read, [], query ? 250 : 0); // debounce typing

  const opened = useRef(0); // bumped by every open, so a late get_notes reply can't replace a form opened after it
  const open = (n: NoteRow | null | undefined) => {
    opened.current++;
    setEditing(n);
  };
  // Search rows carry a snippet and the image ids, get_notes the full body.
  const openNote = (n: NoteRow) => {
    const seq = ++opened.current;
    void api.data.read<NoteRow[]>('get_notes', { ids: [n.id] }).then((r) => seq === opened.current && r[0] && open({ ...n, ...r[0] }), fail);
  };

  const addButton = (
    <Button type='primary' icon={<Plus />} onClick={() => open(null)}>
      {t('common:add')}
    </Button>
  );

  return (
    <div className='page'>
      {holders}
      <PageToolbar hint={<AionSearchInput className='max-w-[480px]' value={query} onChange={setQuery} placeholder={t('searchNotes')} />}>
        {addButton}
      </PageToolbar>
      {loading && <Skeleton variant='grid' />}
      {!loading &&
        !notes.length &&
        (query.trim() ? (
          <EmptyState icon={<Search />} title={t('noNotesFound')} />
        ) : (
          <EmptyState icon={<Notes />} title={t('noNotes')} hint={t('noNotesHint')}>
            {addButton}
          </EmptyState>
        ))}
      <div className='grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'>
        {notes.map((n) => {
          const isBusy = busy.includes(n.id);
          const title = n.title || t('untitled');
          return (
            <article key={n.id} className='note-card relative flex flex-col gap-2 p-4 bg-surface border border-line rounded-card shadow-card transition hover:-translate-y-0.5'>
              {/* Keeps the actions' row even without a chip; they come after the title in DOM for reading and Tab order. */}
              <div className='flex min-h-6'>{n.kind === 'journal' && <Chip tone='accent'>{t('journal')}</Chip>}</div>
              <button type='button' className='link note-open font-600 text-left line-clamp-2' disabled={isBusy} onClick={() => openNote(n)}>
                {title}
              </button>
              <div className='text-ink-2 text-[13px] line-clamp-4'>{highlight(n.snippet ?? '')}</div>
              <div className='row-actions absolute top-4 right-4 z-1 flex'>
                <Button size='mini' type='text' icon={<Edit />} aria-label={t('editNoteLabel', { what: title })} disabled={isBusy} onClick={() => openNote(n)} />
                <Button
                  size='mini'
                  type='text'
                  status='danger'
                  icon={<Delete />}
                  aria-label={t('deleteNote', { what: title })}
                  disabled={isBusy}
                  onClick={() => remove(n.id, 'delete_notes', n.title || n.snippet?.replace(/[⟦⟧]/g, '') || '')}
                />
              </div>
              <Thumbs ids={n.attachment_ids} />
              <div className='mt-auto text-xs text-ink-2'>{when(n.created_at)}</div>
            </article>
          );
        })}
      </div>
      {editing !== undefined && <NoteForm key={editing?.id ?? 'new'} note={editing} onClose={() => open(undefined)} />}
    </div>
  );
}
