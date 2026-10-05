import { Bell, CircleCheck, NotebookPen, Plus, Search, Settings, Sun, Wallet } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationRow, Page, ReminderRow, TaskRow } from '../../shared/types';
import { api } from '../api';
import logo from '../assets/logo.png';
import { shortcutLabel } from '../shortcuts';
import { ConversationList } from './ConversationList';
import { ICON, Kbd } from './ui';

export const NAV_PAGES = ['today', 'tasks', 'notes', 'expenses', 'reminders'] as const;
const NAV_ICON: Record<(typeof NAV_PAGES)[number] | 'settings', ReactNode> = {
  today: <Sun {...ICON} />,
  tasks: <CircleCheck {...ICON} />,
  notes: <NotebookPen {...ICON} />,
  expenses: <Wallet {...ICON} />,
  reminders: <Bell {...ICON} />,
  settings: <Settings {...ICON} />,
};

type Counts = { today: number; tasks: number; reminders: number };

/** The numbers beside Today, Tasks and Reminders; read again when data changes and when the window regains focus. */
function useNavCounts(): Counts {
  const [counts, setCounts] = useState<Counts>({ today: 0, tasks: 0, reminders: 0 });
  const load = useCallback(() => {
    void Promise.all([
      api.data.read<{ tasks_today: TaskRow[]; overdue: TaskRow[] }>('get_today_overview', {}),
      api.data.read<TaskRow[]>('list_tasks', { status: 'todo' }),
      api.data.read<ReminderRow[]>('list_reminders', { status: 'pending' }),
    ]).then(([o, tasks, reminders]) => setCounts({ today: o.tasks_today.length + o.overdue.length, tasks: tasks.length, reminders: reminders.length }), () => {});
  }, []);
  useEffect(() => {
    load();
    const off = api.data.onChanged(load);
    window.addEventListener('focus', load);
    return () => {
      off();
      window.removeEventListener('focus', load);
    };
  }, [load]);
  return counts;
}

type Props = {
  collapsed: boolean;
  mac: boolean;
  page?: Page;
  modelReady: boolean;
  conversations: ConversationRow[];
  selectedId?: number;
  titleOf: (c: ConversationRow) => string;
  onSearch: () => void;
  onNewChat: () => void;
  onGo: (page: Page) => void;
  onOpenChat: (id: number) => void;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (c: ConversationRow) => void;
};

/** The sidebar of the design: search, new chat, the five pages, the conversations by day, and Settings with the model's state. */
export function Sidebar(p: Props) {
  const { t } = useTranslation(['common', 'chat', 'shell']);
  const counts = useNavCounts();
  const { collapsed, mac } = p;
  const countOf = (page: string): number | undefined => (page === 'today' ? counts.today : page === 'tasks' ? counts.tasks : page === 'reminders' ? counts.reminders : undefined);

  const navButton = (page: (typeof NAV_PAGES)[number] | 'settings', i: number) => {
    const on = p.page === page;
    const label = t(`nav.${page}`);
    const count = countOf(page);
    return (
      <button
        key={page}
        type='button'
        aria-current={on ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        title={`${label} (${shortcutLabel(page === 'settings' ? ',' : String(i + 1), mac)})`}
        onClick={() => p.onGo(page)}
        className={`h-[34px] flex items-center gap-2.5 px-2.5 rounded-lg border border-solid text-[13.5px] font-500 cursor-pointer ${collapsed ? 'justify-center' : ''} ${
          on ? 'border-line bg-panel text-ink shadow-sm' : 'border-transparent bg-transparent text-ink-2 hover:bg-hover hover:text-ink'
        }`}
      >
        <span aria-hidden className={`flex text-base ${on ? 'text-accent' : ''}`}>{NAV_ICON[page]}</span>
        {!collapsed && <span className='flex-1 text-left truncate'>{label}</span>}
        {!collapsed && page !== 'settings' && count !== undefined && count > 0 && <span className='font-mono text-[11px] font-500 text-ink-3 min-w-[18px] text-right'>{count}</span>}
        {!collapsed && page === 'settings' && <span title={p.modelReady ? t('shell:connected') : t('shell:notConnected')} className={`w-[7px] h-[7px] rounded-full ${p.modelReady ? 'bg-ok' : 'bg-ink-3'}`} />}
      </button>
    );
  };

  return (
    <aside
      className='shrink-0 flex flex-col overflow-hidden transition-[width] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]'
      style={{ width: collapsed ? 68 : 256 }}
      aria-label={t('shell:sidebar')}
    >
      <div className='drag h-12 shrink-0 flex items-center gap-2.5 px-[18px]'>
        {!mac && (
          <>
            <img src={logo} alt='' className='w-5 h-5 rounded-[5px]' />
            {!collapsed && <span className='font-600 text-[13px] whitespace-nowrap'>{t('appName')}</span>}
          </>
        )}
      </div>
      <div className='flex flex-col gap-1.5 px-3 pt-1 pb-2.5'>
        <button
          type='button'
          onClick={p.onSearch}
          title={t('shell:search')}
          aria-label={collapsed ? t('shell:search') : undefined}
          className={`h-[34px] flex items-center gap-[9px] px-2.5 rounded-[9px] border border-solid border-line bg-panel text-ink-3 text-[13px] shadow-sm cursor-pointer hover:border-accent-line ${collapsed ? 'justify-center' : ''}`}
        >
          <span aria-hidden className='flex text-[15px]'>
            <Search {...ICON} />
          </span>
          {!collapsed && (
            <>
              <span className='flex-1 text-left truncate'>{t('shell:search')}</span>
              <Kbd className='px-[5px] py-px border border-solid border-line rounded'>{shortcutLabel('K', mac)}</Kbd>
            </>
          )}
        </button>
        <button
          type='button'
          onClick={p.onNewChat}
          title={`${t('chat:newChat')} (${shortcutLabel('N', mac)})`}
          aria-label={collapsed ? t('chat:newChat') : undefined}
          className={`h-[34px] flex items-center gap-[9px] px-2.5 rounded-[9px] border-0 bg-accent text-accent-on text-[13px] font-600 cursor-pointer hover:brightness-110 ${collapsed ? 'justify-center' : ''}`}
        >
          <span aria-hidden className='flex text-[15px]'>
            <Plus {...ICON} />
          </span>
          {!collapsed && <span className='flex-1 text-left whitespace-nowrap'>{t('chat:newChat')}</span>}
        </button>
      </div>
      <nav aria-label={t('mainNav')} className='flex flex-col gap-px px-3 py-1'>
        {NAV_PAGES.map((page, i) => navButton(page, i))}
      </nav>
      <div className='flex-1 min-h-0 flex flex-col px-3 pt-1'>
        {!collapsed && (
          <ConversationList
            conversations={p.conversations}
            selectedId={p.selectedId}
            titleOf={p.titleOf}
            onOpen={p.onOpenChat}
            onRename={p.onRename}
            onDelete={p.onDelete}
          />
        )}
      </div>
      <div className='flex flex-col gap-1.5 px-3 pt-2 pb-3 border-t border-t-solid border-line'>{navButton('settings', 5)}</div>
    </aside>
  );
}
