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
          <img key={id} src={attUrl(id)} alt='' onClick={() => setOpen(id)} />
        ))}
      </div>
      <AionModal visible={open !== null} onCancel={() => setOpen(null)} size='large' header={{ title: 'Ảnh' }} footer={null}>
        {open && <img src={attUrl(open)} alt='' style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', margin: '0 auto' }} />}
      </AionModal>
    </>
  );
}
