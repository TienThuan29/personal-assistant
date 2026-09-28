import { ThoughtDisplay } from '@aionui/ui';
import { Markdown } from '@aionui/ui/markdown';
import { Alert, Button } from '@arco-design/web-react';
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage, PendingAction } from '../../shared/types';
import { Thumbs } from '../components/Thumbs';
import { ConfirmCard } from './ConfirmCard';
import type { ChatState } from './useChat';

const TOOL_LABELS: Record<string, string> = {
  get_today_overview: 'xem tổng quan hôm nay',
  list_tasks: 'tra task',
  list_reminders: 'tra nhắc nhở',
  search_notes: 'tìm ghi chú',
  get_notes: 'đọc ghi chú',
  list_expenses: 'tra chi tiêu',
  query_readonly_sql: 'thống kê dữ liệu',
};

/** One message; memoized (with its card edits kept here) so streaming and typing don't re-render every Markdown block. */
const MessageRow = memo(function MessageRow({ m, actions, resolve }: { m: ChatMessage; actions: PendingAction[]; resolve: ChatState['resolve'] }) {
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

  const cards = (m.tool_calls ?? []).flatMap((c) => actions.filter((a) => a.tool_call_id === c.id));
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
          Xác nhận tất cả ({open.length})
        </Button>
      )}
    </div>
  );
});

export function MessageList({ chat }: { chat: ChatState }) {
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
    ro.observe(el.firstElementChild!);
    el.addEventListener('scroll', onScroll);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={ref} className='messages'>
      <div className='msg-list'>
        {!chat.messages.length && !chat.running && (
          <div className='empty-hint'>
            Hỏi “Hôm nay tôi có việc gì?”, nhờ ghi task, ghi chú, khoản chi (kèm ảnh cũng được),
            <br />
            hoặc gõ <b>/</b> để xem lệnh nhanh.
          </div>
        )}
        {chat.messages.map((m) => <MessageRow key={m.id} m={m} actions={chat.actions} resolve={chat.resolve} />)}
        {chat.streaming && (
          <div className='msg-assistant'>
            <Markdown>{chat.streaming}</Markdown>
          </div>
        )}
        {chat.running && !chat.streaming && (
          <ThoughtDisplay running statusText={chat.tool ? `Đang ${TOOL_LABELS[chat.tool] ?? chat.tool}…` : 'Đang suy nghĩ…'} />
        )}
        {chat.error && (
          <Alert
            type='error'
            content={chat.error}
            action={
              <Button size='mini' onClick={() => void chat.retry()}>
                Thử lại
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
