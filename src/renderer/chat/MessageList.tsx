import { ThoughtDisplay } from '@aionui/ui';
import { Markdown } from '@aionui/ui/markdown';
import { Alert, Button, Message, Tooltip } from '@arco-design/web-react';
import { CalendarThirtyTwo, FolderSearch, Sun, Wallet } from '@icon-park/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ASK_TOOL, type ChatMessage, FILE_TOOL_NAMES, type PendingAction, type ToolCall } from '../../shared/types';
import { api, errorText } from '../api';
import { Thumbs } from '../components/Thumbs';
import { AskCard } from './AskCard';
import { ConfirmCard } from './ConfirmCard';
import { COMMANDS } from './SendBox';
import type { ChatState } from './useChat';

const SUGGESTION_ICONS = { homnay: <Sun />, tuannay: <CalendarThirtyTwo />, chitieu: <Wallet /> };

/** What a file tool call searched or read, e.g. `~/Documents/a.txt` or `~/Work · "budget"`, so the user sees what left the machine. */
function fileCallText(c: ToolCall): string {
  let a: { path?: string; pattern?: string; query?: string; under?: string; from_line?: number } = {};
  try {
    a = JSON.parse(c.function.arguments);
  } catch {}
  if (c.function.name === 'read_file') return `${a.path ?? ''}${a.from_line && a.from_line > 1 ? ` :${a.from_line}` : ''}`;
  return `${a.under ?? '~'} · ${c.function.name === 'grep_files' ? `"${a.query ?? ''}"` : (a.pattern ?? '')}`;
}

/** A file tool result as the chat uses it: find/grep list `results`, read_file has one `path`. */
type FileResult = { error?: string; path?: string; results?: { path: string; line?: number }[] };
type Reveal = (path: string) => void;

/** A ~/… path the user can click to see the file selected in Explorer/Finder/the file manager. */
function PathLink({ path, suffix = '', reveal }: { path: string; suffix?: string; reveal: Reveal }) {
  const { t } = useTranslation('chat');
  return (
    <Tooltip content={t('revealFile')}>
      <button type='button' className='file-ref' onClick={() => reveal(path)}>
        {path}
        {suffix}
      </button>
    </Tooltip>
  );
}

/** One file tool call: what it searched or read, then the files it found (open by default when there are few). */
function FileCall({ c, result, reveal }: { c: ToolCall; result?: FileResult; reveal: Reveal }) {
  const icon = <FolderSearch aria-hidden className='text-accent shrink-0' />;
  if (c.function.name === 'read_file')
    return (
      <div className='file-call'>
        {icon}
        {result?.path ? <PathLink path={result.path} reveal={reveal} /> : <code className='truncate'>{fileCallText(c)}</code>}
      </div>
    );
  const items = result?.results ?? [];
  if (!items.length)
    return (
      <div className='file-call'>
        {icon}
        <code className='truncate'>{fileCallText(c)}</code>
        {result && !result.error && <span>(0)</span>}
      </div>
    );
  return (
    <details className='file-call-group' open={items.length <= 5}>
      <summary className='file-call'>
        {icon}
        <code className='truncate'>{fileCallText(c)}</code>
        <span>({items.length})</span>
      </summary>
      <ul>
        {items.map((x, i) => (
          <li key={i}>
            <PathLink path={x.path} suffix={x.line ? `:${x.line}` : ''} reveal={reveal} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One message; memoized (with its card edits kept here) so streaming and typing don't re-render every Markdown block. */
const MessageRow = memo(function MessageRow({
  m,
  actions,
  resolve,
  answer,
  fileResults,
  reveal,
}: {
  m: ChatMessage;
  actions: PendingAction[];
  resolve: ChatState['resolve'];
  answer: ChatState['answer'];
  /** This message's file tool results by tool_call_id. */
  fileResults?: Record<string, FileResult>;
  reveal: Reveal;
}) {
  const { t } = useTranslation('chat');
  const [edits, setEdits] = useState<Record<number, Record<string, unknown>>>({});
  const [confirmingAll, setConfirmingAll] = useState(false);

  if (m.role === 'tool') return null;
  if (m.role === 'user')
    return (
      <div className='msg-user'>
        {m.files && (
          <div className='flex items-center gap-1 text-xs opacity-75 mb-1'>
            <FolderSearch aria-hidden /> {t('fileTag')}
          </div>
        )}
        {m.content}
        <Thumbs ids={m.attachment_ids} />
      </div>
    );
  const fileCalls = (m.tool_calls ?? []).filter((c) => FILE_TOOL_NAMES.includes(c.function.name));

  // By message: tool_call_ids repeat across turns with some gateways. Rows from before migration 2 have no message_id.
  const callIds = new Set((m.tool_calls ?? []).map((c) => c.id));
  const cards = actions.filter((a) => (a.message_id === null ? callIds.has(a.tool_call_id) : a.message_id === m.id));
  const open = cards.filter((a) => a.status === 'pending' && a.tool_name !== ASK_TOOL); // asks are answered one by one, never confirmed in bulk
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
      {fileCalls.map((c) => (
        <FileCall key={c.id} c={c} result={fileResults?.[c.id]} reveal={reveal} />
      ))}
      {cards.map((a) =>
        a.tool_name === ASK_TOOL ? (
          <AskCard key={a.id} action={a} onAnswer={(replies) => answer(a.id, replies)} />
        ) : (
          <ConfirmCard
            key={a.id}
            action={a}
            args={edits[a.id] ?? a.args}
            onArgsChange={(args) => setEdits((e) => ({ ...e, [a.id]: args }))}
            onResolve={async (d) => {
              await decide(a, d);
            }}
          />
        )
      )}
      {open.length > 1 && (
        <Button type='primary' loading={confirmingAll} style={{ alignSelf: 'flex-start' }} onClick={() => void confirmAll()}>
          {t('confirmAll', { count: open.length })}
        </Button>
      )}
    </div>
  );
});

/**
 * File tool results per assistant message id, keyed by tool_call_id. A result is a tool message after its call and before
 * the next assistant/user message (ids repeat across turns with some gateways).
 */
function fileResultsByMessage(messages: ChatMessage[]): Map<number, Record<string, FileResult>> {
  const out = new Map<number, Record<string, FileResult>>();
  let cur: { results: Record<string, FileResult>; ids: Set<string> } | null = null;
  for (const m of messages) {
    if (m.role === 'assistant') {
      const ids = new Set((m.tool_calls ?? []).filter((c) => FILE_TOOL_NAMES.includes(c.function.name)).map((c) => c.id));
      cur = ids.size ? { results: {}, ids } : null;
      if (cur) out.set(m.id, cur.results);
    } else if (m.role === 'tool') {
      if (cur?.ids.has(m.tool_call_id)) {
        try {
          cur.results[m.tool_call_id] = JSON.parse(m.content) as FileResult;
        } catch {}
      }
    } else cur = null;
  }
  return out;
}

export function MessageList({ chat }: { chat: ChatState }) {
  const { t } = useTranslation('chat');
  const tools = t('tool', { returnObjects: true }) as Record<string, string>;
  const ref = useRef<HTMLDivElement>(null);
  const fileResults = useMemo(() => fileResultsByMessage(chat.messages), [chat.messages]);
  const [message, messageHolder] = Message.useMessage();
  const reveal = useCallback((path: string) => void api.files.reveal(path).catch((e: unknown) => message.error?.(errorText(e))), [message]);
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
            <div className='grid grid-cols-1 sm:grid-cols-3 gap-2.5'>
              {COMMANDS.map((key) => (
                <button key={key} type='button' className='suggestion' onClick={() => void chat.send(t(`cmd.${key}.prompt`), [])}>
                  <span aria-hidden className='flex items-center justify-center w-8 h-8 mb-1.5 rounded-ctl bg-accent-soft text-accent text-base'>
                    {SUGGESTION_ICONS[key]}
                  </span>
                  <span>{t(`cmd.${key}.description`)}</span>
                  <code>/{key}</code>
                </button>
              ))}
            </div>
          </div>
        )}
        {messageHolder}
        {chat.messages.map((m) => (
          <MessageRow key={m.id} m={m} actions={chat.actions} resolve={chat.resolve} answer={chat.answer} fileResults={fileResults.get(m.id)} reveal={reveal} />
        ))}
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
