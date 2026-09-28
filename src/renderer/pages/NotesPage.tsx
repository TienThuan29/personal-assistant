import { AionSearchInput, SettingsPageHeader } from '@aionui/ui';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { Delete, Edit, Plus } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
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

  // Search rows carry a snippet and the image ids, get_notes the full body.
  const openNote = (n: NoteRow) => void api.data.read<NoteRow[]>('get_notes', { ids: [n.id] }).then((r) => r[0] && setEditing({ ...n, ...r[0] }), fail);

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title={t('notesTitle')}
        sticky={false}
        description={t('notesHint')}
        actions={
          <Button type='primary' icon={<Plus />} onClick={() => setEditing(null)}>
            {t('common:add')}
          </Button>
        }
      />
      <AionSearchInput value={query} onChange={setQuery} placeholder={t('searchNotes')} style={{ marginTop: 12 }} />
      {loading && <Skeleton />}
      {!loading && !notes.length && <Empty description={query.trim() ? t('noNotesFound') : t('noNotes')} />}
      {notes.map((n) => (
        <div key={n.id} className='row'>
          <div className='row-main'>
            <div>
              {n.kind === 'journal' && <Tag color='purple'>{t('journal')}</Tag>}{' '}
              <button type='button' className='link' onClick={() => openNote(n)}>
                {n.title || t('untitled')}
              </button>
            </div>
            <div className='muted snippet' onClick={() => openNote(n)}>
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
      {editing !== undefined && <NoteForm note={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
