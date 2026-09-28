import { SettingsPageHeader } from '@aionui/ui';
import { Button, Checkbox, Empty } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { type ReactNode, useCallback } from 'react';
import { addDays, parseLocalDate, toLocalDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ReminderRow, TaskRow } from '../../shared/types';
import { api } from '../api';
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

  const taskRows = (list: TaskRow[], overdue: boolean) =>
    list.map((t) => (
      <div key={t.id} className='row'>
        <Checkbox
          aria-label={`Hoàn thành: ${t.title}`}
          checked={busy.includes(t.id)}
          disabled={busy.includes(t.id)}
          onChange={() => void write(t.id, 'update_tasks', { ids: [t.id], patch: { status: 'done' } })}
        />
        <div className='row-main'>{t.title}</div>
        <span className={overdue ? 'overdue' : 'muted'}>{overdue ? dateText(t.due_date!) : t.due_time}</span>
      </div>
    ));

  const reminderRows = (list: ReminderRow[], withDate: boolean) =>
    list.map((r) => (
      <div key={r.id} className='row'>
        <div className='row-main'>{r.message}</div>
        <span className='muted'>{withDate ? new Date(r.remind_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : timeText(r.remind_at)}</span>
        <Button size='mini' disabled={busy.includes(r.id)} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
          Bỏ qua
        </Button>
        <Button
          size='mini'
          type='text'
          status='danger'
          icon={<Delete />}
          aria-label={`Xóa nhắc nhở: ${r.message}`}
          disabled={busy.includes(r.id)}
          onClick={() => remove(r.id, 'delete_reminders', r.message)}
        />
      </div>
    ));

  const sections: [string, ReactNode[]][] = [
    ['Quá hạn', taskRows(data.overdue, true)],
    ['Task hôm nay', taskRows(data.tasks_today, false)],
    ['Nhắc nhở hôm nay', reminderRows(data.reminders_today, false)],
    [`Nhắc nhở ${UPCOMING_DAYS} ngày tới`, reminderRows(data.upcoming, true)],
  ];
  const spent = data.spent_today.length ? data.spent_today.map((s) => formatMoney(s.total, s.currency)).join(' + ') : '0';

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title='Hôm nay'
        sticky={false}
        description={`${data.today ? parseLocalDate(data.today).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }) : ''} · Đã chi hôm nay: ${spent}`}
      />
      {sections.every(([, rows]) => !rows.length) && <Empty description='Hôm nay không có việc hay nhắc nhở nào' />}
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
