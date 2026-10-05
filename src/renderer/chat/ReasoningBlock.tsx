import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/** The model's reasoning while it streams (LM Studio): collapsed by default, follows the newest line when open. */
export function ReasoningBlock({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <details className='text-xs text-ink-2' style={{ margin: '4px 0' }}>
      <summary style={{ cursor: 'pointer' }}>{t('reasoningShow')}</summary>
      <div
        ref={body}
        style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', marginTop: 4, paddingLeft: 10, borderLeft: '2px solid currentColor', opacity: 0.8 }}
      >
        {text}
      </div>
    </details>
  );
}
