import { Button, Radio } from '@arco-design/web-react';
import { Plus, Remind } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, toLocalDate, toLocalTime } from '../../shared/dates';
import type { ReminderRow } from '../../shared/types';
import { api } from '../api';
import { Card, Chip, dayTitle, EmptyState, PageToolbar, RowActions } from '../components/ui';
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
                  <Chip>
                    <span className='tabular-nums inline-block min-w-9 text-center'>{toLocalTime(new Date(r.remind_at))}</span>
                  </Chip>
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
                  <RowActions editLabel={t('editReminderLabel', { what: r.message })} deleteLabel={t('deleteReminder', { what: r.message })} disabled={isBusy} onEdit={() => setEditing(r)} onDelete={() => remove(r.id, 'delete_reminders', r.message)} />
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
