import { Button, Radio, Tag } from '@arco-design/web-react';
import { Delete, Edit, Plus, Remind } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, parseLocalDate, toLocalDate, toLocalTime } from '../../shared/dates';
import type { ReminderRow } from '../../shared/types';
import { api } from '../api';
import { EmptyState, PageToolbar } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { ReminderForm } from './ReminderForm';

const STATUSES = ['pending', 'fired', 'dismissed'] as const;
const HISTORY_DAYS = 90;

export function RemindersPage() {
  const [status, setStatus] = useState('pending');
  const [editing, setEditing] = useState<ReminderRow | null>(); // undefined: closed, null: adding
  // ponytail: list_reminders returns at most 200, oldest first. Pending lists everything; the other views only the last
  // HISTORY_DAYS, newest first, so old history can't crowd out recent rows. Page by from/to if a view ever holds more than 200.
  const read = useCallback(
    () =>
      status === 'pending'
        ? api.data.read<ReminderRow[]>('list_reminders', { status })
        : api.data.read<ReminderRow[]>('list_reminders', { status, from: addDays(toLocalDate(), -HISTORY_DAYS) }).then((rows) => rows.reverse()),
    [status]
  );
  const { data: reminders, loading, busy, write, remove, holders } = useData(read, []);
  const { t } = useTranslation(['pages', 'common']);

  const groups = new Map<string, ReminderRow[]>(); // local date -> rows, in list order
  for (const r of reminders) {
    const day = toLocalDate(new Date(r.remind_at));
    groups.set(day, [...(groups.get(day) ?? []), r]);
  }

  return (
    <div className='page'>
      {holders}
      <PageToolbar>
        <Radio.Group
          type='button'
          value={status}
          onChange={setStatus}
          options={[...STATUSES.map((s) => ({ label: t(`reminderStatus.${s}`), value: s })), { label: t('all'), value: 'all' }]}
        />
        <Button type='primary' icon={<Plus />} onClick={() => setEditing(null)}>
          {t('common:add')}
        </Button>
      </PageToolbar>
      {loading && <Skeleton />}
      {!loading && !reminders.length && <EmptyState icon={<Remind />} title={t('noReminders')} />}
      {[...groups].map(([day, list]) => (
        <section key={day}>
          <div className='group-title'>
            {parseLocalDate(day).toLocaleDateString('vi-VN')} <span className='count'>{list.length}</span>
          </div>
          {list.map((r) => (
            <div key={r.id} className={r.status === 'pending' ? 'row' : 'row is-closed'}>
              <span className='muted'>{toLocalTime(new Date(r.remind_at))}</span>
              <div className='row-main'>
                <button type='button' className='link' disabled={busy.includes(r.id)} onClick={() => setEditing(r)}>
                  {r.message}
                </button>
              </div>
              {status === 'all' && <Tag>{t(`reminderStatus.${r.status}`)}</Tag>}
              <Button
                size='mini'
                type='text'
                icon={<Edit />}
                aria-label={t('editReminderLabel', { what: r.message })}
                disabled={busy.includes(r.id)}
                onClick={() => setEditing(r)}
              />
              {r.status === 'pending' && (
                <Button size='mini' disabled={busy.includes(r.id)} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
                  {t('dismiss')}
                </Button>
              )}
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
          ))}
        </section>
      ))}
      {editing !== undefined && <ReminderForm reminder={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
