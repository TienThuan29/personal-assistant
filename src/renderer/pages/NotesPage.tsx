import { AionModal, AionSearchInput, SettingsPageHeader } from '@aionui/ui';
import { Button, Empty, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useCallback, useState } from 'react';
import type { NoteRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { useData } from '../useData';

/** Renders the ⟦match⟧ markers from FTS snippets as <mark>. */
const highlight = (s: string) => s.split(/[⟦⟧]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));

const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function NotesPage() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<NoteRow | null>(null);
  const read = useCallback(() => api.data.read<NoteRow[]>('search_notes', { query: query.trim() || undefined, limit: 100 }), [query]);
  const { data: notes, busy, remove, fail, holders } = useData(read, [], query ? 250 : 0); // debounce typing

  const openNote = (id: number) => void api.data.read<NoteRow[]>('get_notes', { ids: [id] }).then((r) => setOpen(r[0] ?? null), fail);

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader title='Ghi chú & nhật ký' sticky={false} description='Tìm không cần gõ dấu. Muốn thêm hoặc sửa, hãy nhắn cho trợ lý.' />
      <AionSearchInput value={query} onChange={setQuery} placeholder='Tìm ghi chú…' />
      {!notes.length && <Empty description={query.trim() ? 'Không tìm thấy ghi chú nào' : 'Chưa có ghi chú nào'} />}
      {notes.map((n) => (
        <div key={n.id} className='row'>
          <div className='row-main'>
            <div>
              {n.kind === 'journal' && <Tag color='purple'>Nhật ký</Tag>}{' '}
              <button type='button' className='link' onClick={() => openNote(n.id)}>
                {n.title || 'Không tiêu đề'}
              </button>
            </div>
            <div className='muted snippet' onClick={() => openNote(n.id)}>
              {highlight(n.snippet ?? '')}
            </div>
            <Thumbs ids={n.attachment_ids} />
          </div>
          <span className='muted'>{when(n.created_at)}</span>
          <Button
            size='mini'
            type='text'
            status='danger'
            icon={<Delete />}
            aria-label={`Xóa ghi chú: ${n.title || 'Không tiêu đề'}`}
            disabled={busy.includes(n.id)}
            onClick={() => remove(n.id, 'delete_notes', n.title || n.snippet?.replace(/[⟦⟧]/g, '') || '')}
          />
        </div>
      ))}
      <AionModal
        visible={open !== null}
        onCancel={() => setOpen(null)}
        size='large'
        style={{ height: 'auto' }}
        header={open?.title || 'Ghi chú'}
        footer={null}
      >
        {open && (
          <>
            <div className='muted'>{when(open.created_at)}</div>
            <div className='note-body'>{open.body}</div>
          </>
        )}
      </AionModal>
    </div>
  );
}
