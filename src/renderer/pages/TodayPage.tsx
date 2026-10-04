import { Button, Checkbox } from '@arco-design/web-react';
import { Caution, CheckOne, Comment, Plus, Remind, Sun, Wallet } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, parseLocalDate, partOfDay, toLocalDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ReminderRow, TaskRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { Card, Chip, EmptyState, RowActions, StatCard } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { ExpenseForm } from './ExpenseForm';
import { ReminderForm } from './ReminderForm';
import { TaskForm } from './TaskForm';

type Today = {
  today: string;
  tasks_today: TaskRow[];
  overdue: TaskRow[];
  reminders_today: ReminderRow[];
  spent_today: { currency: string; total: number }[];
  upcoming: ReminderRow[];
};

const EMPTY: Today = { today: '', tasks_today: [], overdue: [], reminders_today: [], spent_today: [], upcoming: [] };
const UPCOMING_DAYS = 7;

const dateText = (date: string) => parseLocalDate(date).toLocaleDateString('vi-VN');
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

const PILL = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-500 cursor-pointer transition active:scale-97';
const PILL_ACCENT = `${PILL} border-0 bg-accent text-accent-on hover:brightness-110`;
const PILL_PLAIN = `${PILL} border border-solid border-line bg-surface text-ink hover:bg-[var(--hover)]`;

export function TodayPage({ go }: { go: (page: 'chat') => void }) {
  // Upcoming starts tomorrow: today's pending reminders already come with the overview.
  const read = useCallback(async (): Promise<Today> => {
    const today = toLocalDate();
    const [overview, upcoming] = await Promise.all([
      api.data.read<Omit<Today, 'upcoming'>>('get_today_overview', {}),
      api.data.read<ReminderRow[]>('list_reminders', { from: addDays(today, 1), to: addDays(today, UPCOMING_DAYS) }),
    ]);
    return { ...overview, upcoming };
  }, []);
  // ponytail: tasks and reminders share one busy list keyed by id, so equal ids briefly disable each other
  const { data, loading, busy, write, remove, holders } = useData(read, EMPTY);
  const { t } = useTranslation(['pages', 'common']);
  const { moneyStyle } = useUiSettings();
  const [adding, setAdding] = useState<'task' | 'expense' | 'reminder' | null>(null);

  const taskRows = (list: TaskRow[], overdue: boolean) =>
    list.map((task) => (
      <div key={task.id} className={busy.includes(task.id) ? 'list-row is-done' : 'list-row'}>
        <Checkbox
          aria-label={t('complete', { title: task.title })}
          checked={busy.includes(task.id)}
          disabled={busy.includes(task.id)}
          onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
        />
        <div className='row-main'>{task.title}</div>
        {overdue ? <Chip tone='danger'>{dateText(task.due_date!)}</Chip> : task.due_time && <span className='text-xs text-ink-2 tabular-nums'>{task.due_time}</span>}
      </div>
    ));

  const reminderRows = (list: ReminderRow[], withDate: boolean) =>
    list.map((r) => (
      <div key={r.id} className='list-row'>
        <Chip>
          <span className='tabular-nums'>
            {withDate ? new Date(r.remind_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : timeText(r.remind_at)}
          </span>
        </Chip>
        <div className='row-main'>{r.message}</div>
        <Button size='mini' disabled={busy.includes(r.id)} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
          {t('dismiss')}
        </Button>
        <RowActions deleteLabel={t('deleteReminder', { what: r.message })} disabled={busy.includes(r.id)} onDelete={() => remove(r.id, 'delete_reminders', r.message)} />
      </div>
    ));

  const longDate = (date: string) => {
    const d = parseLocalDate(date);
    return `${t(`common:weekdayLong.${String(d.getDay() || 7) as '1'}`)}, ${d.toLocaleDateString('vi-VN')}`;
  };
  const spent = data.spent_today.length ? data.spent_today.map((s) => formatMoney(s.total, s.currency, moneyStyle)).join(' + ') : '0';
  const nTasks = data.tasks_today.length;
  const nOverdue = data.overdue.length;
  const nReminders = data.reminders_today.length;
  const summary = [
    data.today && longDate(data.today),
    nTasks && t('sumTasks', { count: nTasks }),
    nOverdue && t('sumOverdue', { count: nOverdue }),
    nReminders && t('sumReminders', { count: nReminders }),
    data.spent_today.length && t('sumSpent', { amount: spent }),
  ].filter(Boolean);
  const free = !nTasks && !nOverdue && !nReminders && !data.upcoming.length;
  const tasks = [...taskRows(data.overdue, true), ...taskRows(data.tasks_today, false)];
  const reminders = [...reminderRows(data.reminders_today, false), ...reminderRows(data.upcoming, true)];
  const empty = (text: string) => <div className='text-ink-2 px-4 py-3'>{text}</div>;

  const askButton = (
    <button type='button' className={PILL_ACCENT} onClick={() => go('chat')}>
      <Comment className='flex' />
      {t('askAssistant')}
    </button>
  );
  const addTaskButton = (
    <button type='button' className={PILL_PLAIN} onClick={() => setAdding('task')}>
      <Plus className='flex' />
      {t('addTask')}
    </button>
  );

  return (
    <div className='page'>
      {holders}
      <div className='flex flex-col gap-5'>
        <div>
          <h2 className='m-0 text-2xl font-600 tracking-tight'>{t(`greeting.${partOfDay(new Date())}`)}</h2>
          <div className='mt-1 min-h-5 text-[13px] text-ink-2'>{summary.join(' · ')}</div>
        </div>
        {loading ? (
          <>
            <Skeleton variant='cards' />
            <Skeleton />
          </>
        ) : free ? (
          <EmptyState icon={<Sun />} title={t('todayFreeTitle')} hint={t('todayFreeHint')}>
            {addTaskButton}
            {askButton}
          </EmptyState>
        ) : (
          <>
            <div className='grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]'>
              <StatCard icon={<Caution />} value={nOverdue} label={t('statOverdue')} tone={nOverdue ? 'danger' : undefined} />
              <StatCard icon={<CheckOne />} value={nTasks} label={t('statTasks')} />
              <StatCard icon={<Remind />} value={nReminders} label={t('statReminders')} />
              <StatCard icon={<Wallet />} value={spent.length > 12 ? <span className='text-xl'>{spent}</span> : spent} label={t('statSpent')} />
            </div>
            <div className='flex flex-wrap gap-2'>
              {askButton}
              {addTaskButton}
              <button type='button' className={PILL_PLAIN} onClick={() => setAdding('expense')}>
                <Plus className='flex' />
                {t('addExpense')}
              </button>
              <button type='button' className={PILL_PLAIN} onClick={() => setAdding('reminder')}>
                <Plus className='flex' />
                {t('addReminder')}
              </button>
            </div>
            <div className='grid gap-4 items-start [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]'>
              <Card title={t('tasksCard')} count={tasks.length}>
                {tasks.length ? tasks : empty(t('noTasksToday'))}
              </Card>
              <Card title={t('remindersCard')} count={reminders.length}>
                {reminders.length ? reminders : empty(t('noRemindersSoon', { days: UPCOMING_DAYS }))}
              </Card>
            </div>
          </>
        )}
      </div>
      {adding === 'task' && <TaskForm task={null} categories={[...data.tasks_today, ...data.overdue].map((x) => x.category)} onClose={() => setAdding(null)} />}
      {adding === 'expense' && <ExpenseForm expense={null} categories={[]} onClose={() => setAdding(null)} />}
      {adding === 'reminder' && <ReminderForm reminder={null} onClose={() => setAdding(null)} />}
    </div>
  );
}
