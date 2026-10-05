import { AionModal } from '@aionui/ui';
import { Button, InputNumber } from '@arco-design/web-react';
import { FileText, Left, Right } from '@icon-park/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PdfDoc } from '../../shared/types';
import { attUrl } from '../api';

/** A PDF in the chat: its name and page count; clicking opens the page-by-page viewer. */
export function PdfCard({ doc }: { doc: PdfDoc }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <button
        type='button'
        aria-label={t('pdfOpen', { name: doc.name })}
        onClick={() => setOpen(1)}
        className='flex items-center gap-2 mt-2 px-3 py-2 border-0 cursor-pointer'
        style={{ borderRadius: 8, background: 'rgba(255,255,255,.18)', color: 'inherit', font: 'inherit', textAlign: 'left' }}
      >
        <FileText aria-hidden />
        <span style={{ wordBreak: 'break-all' }}>{doc.name}</span>
        <span style={{ opacity: 0.75, whiteSpace: 'nowrap' }}>{t('pdfPages', { count: doc.pages.length })}</span>
      </button>
      {open !== null && <PdfViewer doc={doc} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One page at a time (arrows, Home/End, a page box, a thumbnail strip), like a PDF preview. Pages are the stored images. */
function PdfViewer({ doc, start, onClose }: { doc: PdfDoc; start: number; onClose: () => void }) {
  const { t } = useTranslation('chat');
  const total = doc.pages.length;
  const [page, setPage] = useState(start);
  const go = (n: number) => setPage(Math.min(Math.max(Math.round(n) || 1, 1), total));
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return; // the page box keeps its own arrows
      const step: Record<string, () => void> = {
        ArrowLeft: () => go(page - 1),
        ArrowRight: () => go(page + 1),
        Home: () => go(1),
        End: () => go(total),
      };
      if (!step[e.key]) return;
      e.preventDefault();
      step[e.key]();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current=true]')?.scrollIntoView({ block: 'nearest' });
  }, [page]);

  return (
    <AionModal visible onCancel={onClose} size='large' style={{ height: 'auto' }} header={`${doc.name} · ${t('pdfPage', { page, total })}`} footer={null}>
      <div style={{ display: 'flex', gap: 12, height: '70vh' }}>
        <div ref={strip} style={{ width: 84, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }} role='list'>
          {doc.pages.map((id, i) => (
            <button
              key={id}
              type='button'
              role='listitem'
              aria-label={t('pdfPage', { page: i + 1, total })}
              aria-current={i + 1 === page}
              onClick={() => go(i + 1)}
              style={{ padding: 0, background: 'none', borderRadius: 4, cursor: 'pointer', border: `2px solid ${i + 1 === page ? 'var(--accent, #ab502d)' : 'transparent'}` }}
            >
              <img src={attUrl(id)} alt='' loading='lazy' decoding='async' style={{ display: 'block', width: '100%', borderRadius: 2 }} />
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* The whole page fits the pane (a page drawn at the pane's width would need scrolling to reach its text). */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={attUrl(doc.pages[page - 1])}
              alt={t('pdfPage', { page, total })}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 1px 6px rgba(0,0,0,.25)', background: '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Button icon={<Left />} aria-label={t('pdfPrev')} disabled={page <= 1} onClick={() => go(page - 1)} />
            <InputNumber hideControl min={1} max={total} value={page} onChange={(v) => go(Number(v))} aria-label={t('pdfGoto')} style={{ width: 64 }} />
            <span>/ {total}</span>
            <Button icon={<Right />} aria-label={t('pdfNext')} disabled={page >= total} onClick={() => go(page + 1)} />
          </div>
        </div>
      </div>
    </AionModal>
  );
}
