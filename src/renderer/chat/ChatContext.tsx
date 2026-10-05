import { Bell, CircleAlert, CircleCheck, Cpu, Shield, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../shared/money';
import type { Page, PendingAction, TaskRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { ICON } from '../components/ui';
import type { ModelInfo } from './useModelInfo';

type Overview = { tasks_today: TaskRow[]; overdue: TaskRow[]; reminders_today: unknown[]; spent_today: { currency: string; total: number }[] };

const cut = (s: string, n = 56): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What an action is about, in a few words: its title, message, description or the like. */
function actionWhat(a: PendingAction): string {
  const args = a.args as Record<string, unknown>;
  const text = args.title ?? args.message ?? args.description ?? args.body ?? args.category;
  if (typeof text === 'string' && text) return cut(text);
  const ids = args.ids;
  return Array.isArray(ids) ? `#${ids.join(', #')}` : '';
}

const Label = ({ children }: { children: string }) => <div className='text-[11px] font-600 tracking-[0.04em] uppercase text-ink-3'>{children}</div>;

/** The right-hand panel of a chat (design): today at a glance, what this chat changed, and the model in use. */
export function ChatContext({ actions, model, go }: { actions: PendingAction[]; model: ModelInfo | null; go: (page: Page) => void }) {
  const { t } = useTranslation(['chat', 'pages', 'shell']);
  const { moneyStyle } = useUiSettings();
  const [today, setToday] = useState<Overview | null>(null);
  const load = useCallback(() => {
    api.data.read<Overview>('get_today_overview', {}).then(setToday, () => {});
  }, []);
  useEffect(() => {
    load();
    return api.data.onChanged(load);
  }, [load]);

  const spent = today?.spent_today.length ? today.spent_today.map((s) => formatMoney(s.total, s.currency, moneyStyle)).join(' + ') : formatMoney(0, 'VND', moneyStyle);
  const stats: { value: string | number; label: string; page: Page; danger?: boolean; icon: React.ReactNode }[] = [
    { value: today?.overdue.length ?? 0, label: t('pages:statOverdue'), page: 'tasks', danger: !!today?.overdue.length, icon: <CircleAlert {...ICON} /> },
    { value: today?.tasks_today.length ?? 0, label: t('pages:statTasks'), page: 'tasks', icon: <CircleCheck {...ICON} /> },
    { value: today?.reminders_today.length ?? 0, label: t('pages:statReminders'), page: 'reminders', icon: <Bell {...ICON} /> },
    { value: spent, label: t('pages:statSpent'), page: 'expenses', icon: <Wallet {...ICON} /> },
  ];
  const names = t('action', { returnObjects: true }) as Record<string, string>;
  const changes = actions.filter((a) => a.tool_name !== 'ask_user');

  return (
    <aside aria-label={t('shell:context')} className='w-[280px] shrink-0 flex flex-col gap-[22px] px-4 py-5 overflow-y-auto bg-sunken border-l border-l-solid border-line'>
      <section className='flex flex-col gap-2'>
        <Label>{t('shell:ctxToday')}</Label>
        <div className='grid grid-cols-2 gap-1.5'>
          {stats.map((s) => (
            <button
              key={s.label}
              type='button'
              onClick={() => go(s.page)}
              className='flex flex-col gap-0.5 p-2.5 text-left border border-solid border-line rounded-[10px] bg-panel cursor-pointer hover:border-accent-line'
            >
              <span className={`text-[17px] font-600 tabular-nums truncate max-w-full ${s.danger ? 'text-danger' : ''}`}>{s.value}</span>
              <span className='text-[11.5px] text-ink-2'>{s.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className='flex flex-col gap-2'>
        <Label>{t('shell:ctxActions')}</Label>
        {!changes.length && <div className='text-[12.5px] text-ink-3'>{t('shell:ctxNone')}</div>}
        {changes.map((a) => (
          <div key={a.id} className='flex gap-2.5 p-2.5 border border-solid border-line rounded-[10px] bg-panel'>
            <span aria-hidden className={`w-[7px] h-[7px] mt-1.5 shrink-0 rounded-full ${a.status === 'pending' ? 'bg-accent' : a.status === 'confirmed' ? 'bg-ok' : 'bg-ink-3'}`} />
            <div className='min-w-0 flex flex-col gap-px'>
              <span className='text-[12.5px] font-600'>{names[a.tool_name] ?? a.tool_name}</span>
              <span className='text-[12.5px] text-ink-2 truncate'>{actionWhat(a)}</span>
              <span className='text-[11.5px] text-ink-3'>{t(`state.${a.status}`)}</span>
            </div>
          </div>
        ))}
      </section>
      <section className='flex flex-col gap-2'>
        <Label>{t('shell:ctxModel')}</Label>
        <div className='flex items-center gap-2.5 p-2.5 border border-solid border-line rounded-[10px] bg-panel'>
          <span aria-hidden className='flex text-base text-accent'>
            <Cpu {...ICON} />
          </span>
          <div className='flex-1 min-w-0 flex flex-col'>
            <span className='font-mono text-[12.5px] font-500 truncate'>{model?.name || t('shell:modelAuto')}</span>
            <span className='text-[11.5px] text-ink-2'>{model?.provider ?? ''}</span>
          </div>
          <span className={`w-[7px] h-[7px] rounded-full ${model?.ready ? 'bg-ok' : 'bg-ink-3'}`} />
        </div>
        <div className='flex gap-2 p-0.5 text-xs leading-normal text-ink-2'>
          <span aria-hidden className='flex mt-0.5 text-ok'>
            <Shield {...ICON} />
          </span>
          {t('shell:ctxLocal')}
        </div>
      </section>
    </aside>
  );
}
