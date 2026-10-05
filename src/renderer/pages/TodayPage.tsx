import { AlertCircle, ArrowRight, CircleCheck, Bell, MessageSquare, Plus, Wallet, Check, Sun } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, parseLocalDate, toLocalDate, toLocalTime } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ExpenseList, Page, ReminderRow, TaskRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { CaptureBar } from '../components/capture';
import { Btn, Card, Chip, Count, dayTitle, EmptyState, ICON, IconBtn, PageBody, RoundCheck, StatCard } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { ReminderForm } from './ReminderForm';
import { TaskForm } from './TaskForm';

type Today = {
  today: string;
  tasks_today: TaskRow[];
  overdue: TaskRow[];
  reminders_today: ReminderRow[];
  spent_today: { currency: string; total: number }[];
  month_spent: { currency: string; total: number }[];
  upcoming: ReminderRow[];
};

const EMPTY: Today = { today: '', tasks_today: [], overdue: [], reminders_today: [], spent_today: [], month_spent: [], upcoming: [] };
const UPCOMING_DAYS = 7;

export function TodayPage({ go }: { go: (page: Page) => void }) {
  // Upcoming starts tomorrow: today's pending reminders already come with the overview.
  const read = useCallback(async (): Promise<Today> => {
    const today = toLocalDate();
    const [overview, upcoming, month] = await Promise.all([
      api.data.read<Omit<Today, 'upcoming' | 'month_spent'>>('get_today_overview', {}),
      api.data.read<ReminderRow[]>('list_reminders', { from: addDays(today, 1), to: addDays(today, UPCOMING_DAYS) }),
      api.data.read<{ month: string; currency: string; total: number }[]>('expense_months', { to: today.slice(0, 7), months: 1 }),
    ]);
    return { ...overview, upcoming, month_spent: month.map((m) => ({ currency: m.currency, total: m.total })) };
  }, []);
  // ponytail: tasks and reminders share one busy list keyed by id, so equal ids briefly disable each other
  const { data, loading, busy, write, remove, holders } = useData(read, EMPTY);
  const { t } = useTranslation(['pages', 'common', 'shell']);
  const { moneyStyle, language } = useUiSettings();
  const [adding, setAdding] = useState<'task' | 'reminder' | null>(null);
  const [editing, setEditing] = useState<{ task?: TaskRow; reminder?: ReminderRow } | null>(null);

  const money = (rows: { currency: string; total: number }[]) => (rows.length ? rows.map((s) => formatMoney(s.total, s.currency, moneyStyle)).join(' + ') : formatMoney(0, 'VND', moneyStyle));
  const nTasks = data.tasks_today.length;
  const nOverdue = data.overdue.length;
  const nReminders = data.reminders_today.length;
  const tasks = [...data.overdue, ...data.tasks_today];
  const reminders = [...data.reminders_today, ...data.upcoming];
  const free = !nTasks && !nOverdue && !nReminders && !data.upcoming.length;

  const d = data.today ? parseLocalDate(data.today) : new Date();
  const dateLong = `${t(`common:weekdayLong.${String(d.getDay() || 7) as '1'}`)}, ${d.toLocaleDateString(language === 'en' ? 'en-GB' : 'vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const hour = new Date().getHours();
  const greeting = t(`greeting.${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`);
  const summary = [nTasks && t('sumTasks', { count: nTasks }), nOverdue && t('sumOverdue', { count: nOverdue }), nReminders && t('sumReminders', { count: nReminders })].filter(Boolean).join(' · ');

  const dueText = (task: TaskRow) => (task.due_date ? [dayTitle(task.due_date, t), task.due_time].filter(Boolean).join(' · ') : '');

  return (
    <PageBody max={1080} top={40}>
      {holders}
      <div className='flex flex-wrap items-end gap-6'>
        <div className='flex-1 min-w-[280px]'>
          <div className='font-mono text-[11.5px] font-500 tracking-[0.06em] uppercase text-ink-3'>{dateLong}</div>
          <h1 className='mt-2 mb-1.5 text-[34px] leading-[1.1] font-600 tracking-[-0.025em]'>{greeting}</h1>
          <div className='min-h-[22px] text-[15px] text-ink-2'>{summary}</div>
        </div>
        <Btn icon={<MessageSquare {...ICON} />} onClick={() => go('chat')}>
          {t('askAssistant')}
        </Btn>
      </div>

      <CaptureBar />

      {loading ? (
        <>
          <Skeleton variant='cards' />
          <Skeleton />
        </>
      ) : free ? (
        <EmptyState icon={<Sun {...ICON} />} title={t('todayFreeTitle')} hint={t('todayFreeHint')}>
          <Btn icon={<Plus {...ICON} />} onClick={() => setAdding('task')}>
            {t('addTask')}
          </Btn>
          <Btn variant='primary' icon={<MessageSquare {...ICON} />} onClick={() => go('chat')}>
            {t('askAssistant')}
          </Btn>
        </EmptyState>
      ) : (
        <>
          <div className='grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]'>
            <StatCard icon={<AlertCircle {...ICON} />} label={t('statOverdue')} value={nOverdue} sub={t('needAttention')} tone={nOverdue ? 'danger' : undefined} onClick={() => go('tasks')} />
            <StatCard icon={<CircleCheck {...ICON} />} label={t('statTasks')} value={nTasks} sub={t('openSub')} onClick={() => go('tasks')} />
            <StatCard icon={<Bell {...ICON} />} label={t('statReminders')} value={nReminders} sub={t('stillToCome')} onClick={() => go('reminders')} />
            <StatCard
              icon={<Wallet {...ICON} />}
              label={t('statSpent')}
              value={money(data.spent_today)}
              sub={t('thisMonth', { amount: money(data.month_spent) })}
              onClick={() => go('expenses')}
            />
          </div>
          <div className='grid gap-4 items-start [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]'>
            <Card
              title={t('tasksCard')}
              count={tasks.length}
              action={
                <>
                  <IconBtn label={t('addTask')} icon={<Plus {...ICON} />} onClick={() => setAdding('task')} />
                  <button type='button' onClick={() => go('tasks')} className='flex items-center gap-1 border-0 bg-transparent text-accent text-[12.5px] font-500 cursor-pointer'>
                    {t('viewAll')}
                    <ArrowRight {...ICON} />
                  </button>
                </>
              }
            >
              {!tasks.length && <div className='px-4 py-7 text-center text-[13px] text-ink-3'>{t('noTasksToday')}</div>}
              {tasks.map((task) => {
                const overdue = !!task.due_date && task.due_date < data.today;
                const isBusy = busy.includes(task.id);
                return (
                  <div key={task.id} className={`list-row ${isBusy ? 'is-done' : ''}`}>
                    <RoundCheck
                      checked={isBusy}
                      disabled={isBusy}
                      urgent={task.priority === 1}
                      label={t('complete', { title: task.title })}
                      onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
                    />
                    <button type='button' className='row-main link text-[13.5px] font-400 truncate' onClick={() => setEditing({ task })}>
                      {task.title}
                    </button>
                    {task.priority === 1 && <Chip tone='danger'>{t('priorityHigh')}</Chip>}
                    <Chip>{(t('common:category', { returnObjects: true }) as Record<string, string>)[task.category] ?? task.category}</Chip>
                    <span className={`min-w-16 text-right text-xs whitespace-nowrap tabular-nums ${overdue ? 'text-danger' : 'text-ink-3'}`}>{dueText(task)}</span>
                  </div>
                );
              })}
            </Card>
            <Card
              title={t('upNext')}
              count={reminders.length}
              action={
                <button type='button' onClick={() => go('reminders')} className='flex items-center gap-1 border-0 bg-transparent text-accent text-[12.5px] font-500 cursor-pointer'>
                  {t('viewAll')}
                  <ArrowRight {...ICON} />
                </button>
              }
            >
              {!reminders.length && <div className='px-4 py-7 text-center text-[13px] text-ink-3'>{t('noRemindersSoon', { days: UPCOMING_DAYS })}</div>}
              {reminders.map((r) => {
                const at = new Date(r.remind_at);
                const isBusy = busy.includes(r.id);
                return (
                  <div key={r.id} className='list-row'>
                    <span className='font-mono text-xs font-500 px-2 py-[3px] rounded-md bg-accent-soft text-accent'>{toLocalTime(at)}</span>
                    <button type='button' className='row-main link text-[13.5px] font-400 truncate' onClick={() => setEditing({ reminder: r })}>
                      {r.message}
                    </button>
                    <span className='text-xs text-ink-3 whitespace-nowrap'>{dayTitle(toLocalDate(at), t)}</span>
                    <IconBtn
                      label={t('dismissLabel', { what: r.message })}
                      icon={<Check {...ICON} />}
                      disabled={isBusy}
                      onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}
                    />
                  </div>
                );
              })}
            </Card>
          </div>
        </>
      )}
      {adding === 'task' && <TaskForm task={null} categories={[]} onClose={() => setAdding(null)} />}
      {adding === 'reminder' && <ReminderForm reminder={null} onClose={() => setAdding(null)} />}
      {editing?.task && <TaskForm task={editing.task} categories={[]} onClose={() => setEditing(null)} />}
      {editing?.reminder && <ReminderForm reminder={editing.reminder} onClose={() => setEditing(null)} />}
    </PageBody>
  );
}
