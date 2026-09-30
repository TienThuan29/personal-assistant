import { AionSearchInput } from '@aionui/ui';
import { Button, Tag } from '@arco-design/web-react';
import { Delete, Edit, Notes, Plus, Search } from '@icon-park/react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { EmptyState, PageToolbar } from '../components/ui';
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

  return (
    <div className='page'>
      {holders}
      <PageToolbar hint={t('notesHint')}>
        <Button type='primary' icon={<Plus />} onClick={() => open(null)}>
          {t('common:add')}
        </Button>
      </PageToolbar>
      <AionSearchInput value={query} onChange={setQuery} placeholder={t('searchNotes')} />
      {loading && <Skeleton />}
      {!loading && !notes.length && (query.trim() ? <EmptyState icon={<Search />} title={t('noNotesFound')} /> : <EmptyState icon={<Notes />} title={t('noNotes')} />)}
      {notes.map((n) => (
        <div key={n.id} className='row'>
          <div className='row-main'>
            <div>
              {n.kind === 'journal' && <Tag color='purple'>{t('journal')}</Tag>}{' '}
              <button type='button' className='link' disabled={busy.includes(n.id)} onClick={() => openNote(n)}>
                {n.title || t('untitled')}
              </button>
            </div>
            <div className='muted snippet' onClick={() => busy.includes(n.id) || openNote(n)}>
              {highlight(n.snippet ?? '')}
            </div>
            <Thumbs ids={n.attachment_ids} />
          </div>
          <span className='muted'>{when(n.created_at)}</span>
          <Button
            size='mini'
            type='text'
            icon={<Edit />}
            aria-label={t('editNoteLabel', { what: n.title || t('untitled') })}
            disabled={busy.includes(n.id)}
            onClick={() => openNote(n)}
          />
          <Button
            size='mini'
            type='text'
            status='danger'
            icon={<Delete />}
            aria-label={t('deleteNote', { what: n.title || t('untitled') })}
            disabled={busy.includes(n.id)}
            onClick={() => remove(n.id, 'delete_notes', n.title || n.snippet?.replace(/[⟦⟧]/g, '') || '')}
          />
        </div>
      ))}
      {editing !== undefined && <NoteForm key={editing?.id ?? 'new'} note={editing} onClose={() => open(undefined)} />}
    </div>
  );
}
