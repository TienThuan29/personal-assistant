import { AionModal } from '@aionui/ui';
import { useState } from 'react';
import { attUrl, splitIds } from '../api';

/** Image thumbnails (ids array or comma-separated) with a click-to-zoom modal. */
export function Thumbs({ ids }: { ids?: string[] | string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = Array.isArray(ids) ? ids : splitIds(ids);
  if (!list.length) return null;
  return (
    <>
      <div className='thumbs'>
        {list.map((id) => (
          <button key={id} type='button' className='thumb' aria-label='Xem ảnh đính kèm' onClick={() => setOpen(id)}>
            <img
              src={attUrl(id)}
              alt='Ảnh đính kèm'
              onError={(e) => {
                e.currentTarget.closest('button')!.style.display = 'none'; // file missing or not an image
              }}
            />
          </button>
        ))}
      </div>
      <AionModal
        visible={open !== null}
        onCancel={() => setOpen(null)}
        size='large'
        style={{ height: 'auto' }}
        header={{ title: 'Ảnh' }}
        footer={null}
      >
        {open && (
          <img src={attUrl(open)} alt='Ảnh đính kèm' style={{ display: 'block', maxWidth: '100%', maxHeight: '75vh', margin: '0 auto' }} />
        )}
      </AionModal>
    </>
  );
}
