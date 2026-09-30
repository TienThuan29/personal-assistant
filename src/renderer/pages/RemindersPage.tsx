import { Button, Radio } from '@arco-design/web-react';
import { Delete, Edit, Plus, Remind } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, toLocalDate, toLocalTime } from '../../shared/dates';
import type { ReminderRow } from '../../shared/types';
import { api } from '../api';
import { Card, Chip, dayTitle, EmptyState, PageToolbar } from '../components/ui';
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

  const addButton = (
    <Button type='primary' icon={<Plus />} onClick={() => setEditing(null)}>
      {t('common:add')}
    </Button>
  );

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
        {addButton}
      </PageToolbar>
      {loading && <Skeleton />}
      {!loading && !reminders.length && (
        <EmptyState icon={<Remind />} title={t('noReminders')} hint={t('noRemindersHint')}>
          {addButton}
        </EmptyState>
      )}
      <div className='flex flex-col gap-4'>
        {[...groups].map(([day, list]) => (
          <Card key={day} title={dayTitle(day, t)} count={list.length}>
            {list.map((r) => {
              const isBusy = busy.includes(r.id);
              return (
                <div key={r.id} className={r.status === 'pending' ? 'list-row' : 'list-row is-closed'}>
                  <span className='shrink-0 inline-flex items-center justify-center min-w-14 h-6 px-2 rounded-md bg-pill text-ink-2 text-[13px] tabular-nums'>
                    {toLocalTime(new Date(r.remind_at))}
                  </span>
                  <div className='row-main'>
                    <button type='button' className='link' disabled={isBusy} onClick={() => setEditing(r)}>
                      {r.message}
                    </button>
                  </div>
                  {status === 'all' && <Chip>{t(`reminderStatus.${r.status}`)}</Chip>}
                  {r.status === 'pending' && (
                    <Button size='mini' disabled={isBusy} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
                      {t('dismiss')}
                    </Button>
                  )}
                  <div className='row-actions flex'>
                    <Button
                      size='mini'
                      type='text'
                      icon={<Edit />}
                      aria-label={t('editReminderLabel', { what: r.message })}
                      disabled={isBusy}
                      onClick={() => setEditing(r)}
                    />
                    <Button
                      size='mini'
                      type='text'
                      status='danger'
                      icon={<Delete />}
                      aria-label={t('deleteReminder', { what: r.message })}
                      disabled={isBusy}
                      onClick={() => remove(r.id, 'delete_reminders', r.message)}
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        ))}
      </div>
      {editing !== undefined && <ReminderForm reminder={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
