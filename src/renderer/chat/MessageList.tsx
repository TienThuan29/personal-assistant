import { ThoughtDisplay } from '@aionui/ui';
import { Markdown } from '@aionui/ui/markdown';
import { Alert, Button } from '@arco-design/web-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, PendingAction } from '../../shared/types';
import { Thumbs } from '../components/Thumbs';
import { ConfirmCard } from './ConfirmCard';
import { COMMANDS } from './SendBox';
import type { ChatState } from './useChat';

/** One message; memoized (with its card edits kept here) so streaming and typing don't re-render every Markdown block. */
const MessageRow = memo(function MessageRow({ m, actions, resolve }: { m: ChatMessage; actions: PendingAction[]; resolve: ChatState['resolve'] }) {
  const { t } = useTranslation('chat');
  const [edits, setEdits] = useState<Record<number, Record<string, unknown>>>({});
  const [confirmingAll, setConfirmingAll] = useState(false);

  if (m.role === 'tool') return null;
  if (m.role === 'user')
    return (
      <div className='msg-user'>
        {m.content}
        <Thumbs ids={m.attachment_ids} />
      </div>
    );

  // By message: tool_call_ids repeat across turns with some gateways. Rows from before migration 2 have no message_id.
  const callIds = new Set((m.tool_calls ?? []).map((c) => c.id));
  const cards = actions.filter((a) => (a.message_id === null ? callIds.has(a.tool_call_id) : a.message_id === m.id));
  const open = cards.filter((a) => a.status === 'pending');
  const decide = (a: PendingAction, d: 'confirm' | 'cancel') => resolve(a.id, d, d === 'confirm' ? edits[a.id] : undefined);
  const confirmAll = async () => {
    setConfirmingAll(true);
    try {
      // Sequential by design; stop at the first failure so its error stays visible.
      for (const a of open) if (!(await decide(a, 'confirm'))) break; // oxlint-disable-line no-await-in-loop
    } finally {
      setConfirmingAll(false);
    }
  };

  return (
    <div className='msg-assistant'>
      {m.content && <Markdown>{m.content}</Markdown>}
      {cards.map((a) => (
        <ConfirmCard
          key={a.id}
          action={a}
          args={edits[a.id] ?? a.args}
          onArgsChange={(args) => setEdits((e) => ({ ...e, [a.id]: args }))}
          onResolve={async (d) => {
            await decide(a, d);
          }}
        />
      ))}
      {open.length > 1 && (
        <Button type='primary' loading={confirmingAll} style={{ alignSelf: 'flex-start' }} onClick={() => void confirmAll()}>
          {t('confirmAll', { count: open.length })}
        </Button>
      )}
    </div>
  );
});

export function MessageList({ chat }: { chat: ChatState }) {
  const { t } = useTranslation('chat');
  const tools = t('tool', { returnObjects: true }) as Record<string, string>;
  const ref = useRef<HTMLDivElement>(null);
  // Follow new content while the user is at the bottom. This watches the list's size, not its content (as useAutoScroll
  // does): Markdown fills its shadow root a render after it mounts, so a content check scrolls too early and stops short.
  useEffect(() => {
    const el = ref.current!;
    let stick = true;
    let lastTop = 0;
    const onScroll = () => {
      // Scrolling up unsticks, reaching the bottom sticks again. The scroll event of our own jump can arrive after
      // more growth, so a gap alone must not unstick.
      stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40 || (stick && el.scrollTop >= lastTop);
      lastTop = el.scrollTop;
    };
    const ro = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el.firstElementChild!); // content growth
    ro.observe(el); // the list itself shrinking: the send box grew, or the window resized
    el.addEventListener('scroll', onScroll);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={ref} className='messages'>
      <div className='msg-list' aria-live='polite'>
        {!chat.messages.length && !chat.running && (
          <div className='chat-empty'>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyHint')}</p>
            <div className='suggestions'>
              {COMMANDS.map((key) => (
                <button key={key} type='button' className='suggestion' onClick={() => void chat.send(t(`cmd.${key}.prompt`), [])}>
                  <span>{t(`cmd.${key}.description`)}</span>
                  <code>/{key}</code>
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m) => <MessageRow key={m.id} m={m} actions={chat.actions} resolve={chat.resolve} />)}
        {chat.streaming && (
          <div className='msg-assistant'>
            <Markdown>{chat.streaming}</Markdown>
            <span className='caret' aria-hidden='true' />
          </div>
        )}
        {chat.running && !chat.streaming && (
          <ThoughtDisplay running statusText={chat.tool ? (tools[chat.tool] ?? t('toolRunning', { name: chat.tool })) : t('thinking')} />
        )}
        {chat.error && (
          <Alert
            type='error'
            content={chat.error.message}
            action={
              chat.error.turn && (
                <Button size='mini' onClick={() => void chat.retry()}>
                  {t('retry')}
                </Button>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
