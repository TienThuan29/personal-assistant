import { AionScrollArea } from '@aionui/ui';
import { Dropdown, Input, Menu, Message } from '@arco-design/web-react';
import { Delete, Edit, More } from '@icon-park/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DayBucket, dayBucket, toLocalDate } from '../../shared/dates';
import type { ConversationRow } from '../../shared/types';
import { errorText } from '../api';

const BUCKETS: DayBucket[] = ['today', 'yesterday', 'week', 'older'];

type Props = {
  conversations: ConversationRow[];
  selectedId?: number;
  titleOf: (c: ConversationRow) => string;
  onOpen: (id: number) => void;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (c: ConversationRow) => void;
};

/** Conversations grouped by local day of updated_at, with inline rename (design §2). */
export function ConversationList({ conversations, selectedId, titleOf, onOpen, onRename, onDelete }: Props) {
  const { t } = useTranslation(['chat', 'common']);
  const [message, messageHolder] = Message.useMessage();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<number | null>(null); // the row whose "⋯" menu is open
  const active = useRef(false); // false once exited, so a late blur (Escape, unmount) can't save
  const busy = useRef(false); // Enter then blur while saving must not rename twice
  const refocus = useRef<number | null>(null); // after Enter/Escape, keyboard focus goes back to the row
  const fresh = useRef(false); // select all on the input's first focus only, not when the window regains focus

  const start = (c: ConversationRow) => {
    active.current = true;
    fresh.current = true;
    setDraft(titleOf(c));
    setEditing(c.id);
  };
  const exit = (keyboard: boolean) => {
    active.current = false;
    refocus.current = keyboard ? editing : null;
    setEditing(null);
  };
  /** `input` is set for Enter: focus returns to the row only if the input still has it after the save. */
  const commit = async (c: ConversationRow, input: HTMLInputElement | null) => {
    if (!active.current || busy.current) return;
    const title = draft.trim();
    if (!title || title === titleOf(c)) return exit(!!input);
    busy.current = true;
    try {
      await onRename(c.id, title);
      exit(!!input && document.activeElement === input);
    } catch (e) {
      message.error?.(errorText(e));
    } finally {
      busy.current = false;
    }
  };

  const today = toLocalDate();
  const groups = BUCKETS.map((b) => ({ b, items: conversations.filter((c) => dayBucket(c.updated_at, today) === b) })).filter((g) => g.items.length);

  return (
    <AionScrollArea className='flex-1 min-h-0'>
      {messageHolder}
      {groups.map(({ b, items }) => (
        <section key={b}>
          <h2 className='m-0 px-3 pt-3 pb-1 text-xs font-500 text-ink-2'>{t(`group.${b}`)}</h2>
          {items.map((c) => {
            const title = titleOf(c);
            const on = c.id === selectedId;
            return editing === c.id ? (
              <Input
                key={c.id}
                size='small'
                autoFocus
                value={draft}
                onChange={setDraft}
                onFocus={(e) => {
                  if (fresh.current) e.target.select();
                  fresh.current = false;
                }}
                onPressEnter={(e) => void commit(c, e.currentTarget as HTMLInputElement)}
                onBlur={() => document.hasFocus() && void commit(c, null)} // not when the window loses focus
                onKeyDown={(e) => e.key === 'Escape' && exit(true)}
                aria-label={t('rename')}
                className='my-0.5'
              />
            ) : (
              <div
                key={c.id}
                // Escape from the portaled menu bubbles here through the React tree; focus goes back to "⋯".
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || menuFor !== c.id) return;
                  setMenuFor(null);
                  e.currentTarget.querySelector<HTMLElement>('.conv-more')?.focus();
                }}
                className={`conv-row flex items-center rounded-ctl ${on ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-[var(--hover)]'}`}>
                <button
                  type='button'
                  ref={(el) => {
                    if (el && refocus.current === c.id) {
                      refocus.current = null;
                      el.focus();
                    }
                  }}
                  title={title}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onOpen(c.id)}
                  onDoubleClick={() => start(c)}
                  className={`flex-1 min-w-0 h-8 pl-3 pr-1 border-0 bg-transparent text-left text-[13px] truncate cursor-pointer text-inherit ${on ? 'font-500' : ''}`}
                >
                  {title}
                </button>
                <Dropdown
                  trigger='click'
                  position='br'
                  popupVisible={menuFor === c.id}
                  onVisibleChange={(v) => {
                    setMenuFor((m) => (v ? c.id : m === c.id ? null : m));
                    // The popup is portaled to body: move focus into it so the items are keyboard-reachable.
                    if (v) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.conv-menu-${c.id} .arco-dropdown-menu-item`)?.focus());
                  }}
                  droplist={
                    <Menu
                      className={`conv-menu-${c.id}`}
                      onClickMenuItem={(key, e) => {
                        // Arco acts on Enter keydown; without this the key's default activation lands on whatever has focus next.
                        e.preventDefault();
                        if (key === 'rename') start(c);
                        else onDelete(c);
                      }}
                    >
                      <Menu.Item key='rename'>
                        <Edit className='mr-2' />
                        {t('rename')}
                      </Menu.Item>
                      <Menu.Item key='delete' className='!text-danger'>
                        <Delete className='mr-2' />
                        {t('common:delete')}
                      </Menu.Item>
                    </Menu>
                  }
                >
                  <button
                    type='button'
                    aria-label={t('conversationMenu', { title })}
                    className='conv-more flex shrink-0 items-center justify-center w-7 h-7 mr-0.5 rounded-lg border-0 bg-transparent text-ink-2 cursor-pointer hover:text-ink'
                  >
                    <More />
                  </button>
                </Dropdown>
              </div>
            );
          })}
        </section>
      ))}
    </AionScrollArea>
  );
}
