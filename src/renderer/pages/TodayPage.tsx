import { SettingsPageHeader } from '@aionui/ui';
import { Button, Checkbox, Empty } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, parseLocalDate, toLocalDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ReminderRow, TaskRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { useData } from '../useData';

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

export function TodayPage() {
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
  const { data, busy, write, remove, holders } = useData(read, EMPTY);
  const { t } = useTranslation(['pages', 'common']);
  const { moneyStyle } = useUiSettings();

  const taskRows = (list: TaskRow[], overdue: boolean) =>
    list.map((task) => (
      <div key={task.id} className='row'>
        <Checkbox
          aria-label={t('complete', { title: task.title })}
          checked={busy.includes(task.id)}
          disabled={busy.includes(task.id)}
          onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
        />
        <div className='row-main'>{task.title}</div>
        <span className={overdue ? 'overdue' : 'muted'}>{overdue ? dateText(task.due_date!) : task.due_time}</span>
      </div>
    ));

  const reminderRows = (list: ReminderRow[], withDate: boolean) =>
    list.map((r) => (
      <div key={r.id} className='row'>
        <div className='row-main'>{r.message}</div>
        <span className='muted'>{withDate ? new Date(r.remind_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : timeText(r.remind_at)}</span>
        <Button size='mini' disabled={busy.includes(r.id)} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
          {t('dismiss')}
        </Button>
        <Button
          size='mini'
          type='text'
          status='danger'
          icon={<Delete />}
          aria-label={t('deleteReminder', { what: r.message })}
          disabled={busy.includes(r.id)}
          onClick={() => remove(r.id, 'delete_reminders', r.message)}
        />
      </div>
    ));

  const sections: [string, ReactNode[]][] = [
    [t('overdue'), taskRows(data.overdue, true)],
    [t('tasksToday'), taskRows(data.tasks_today, false)],
    [t('remindersToday'), reminderRows(data.reminders_today, false)],
    [t('remindersNext', { days: UPCOMING_DAYS }), reminderRows(data.upcoming, true)],
  ];
  const longDate = (date: string) => {
    const d = parseLocalDate(date);
    return `${t(`common:weekdayLong.${String(d.getDay() || 7) as '1'}`)}, ${d.toLocaleDateString('vi-VN')}`;
  };
  const spent = data.spent_today.length ? data.spent_today.map((s) => formatMoney(s.total, s.currency, moneyStyle)).join(' + ') : '0';

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title={t('common:nav.today')}
        sticky={false}
        description={`${data.today ? longDate(data.today) : ''} · ${t('spentToday', { amount: spent })}`}
      />
      {sections.every(([, rows]) => !rows.length) && <Empty description={t('todayEmpty')} />}
      {sections
        .filter(([, rows]) => rows.length)
        .map(([title, rows]) => (
          <section key={title}>
            <div className='group-title'>
              {title} ({rows.length})
            </div>
            {rows}
          </section>
        ))}
    </div>
  );
}
