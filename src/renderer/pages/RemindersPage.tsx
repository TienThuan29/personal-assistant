import { SettingsPageHeader } from '@aionui/ui';
import { Button, Empty, Radio, Space, Tag } from '@arco-design/web-react';
import { Delete, Edit, Plus } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, toLocalDate, toLocalTime } from '../../shared/dates';
import type { ReminderRow } from '../../shared/types';
import { api } from '../api';
import { Skeleton, useData } from '../useData';
import { ReminderForm } from './ReminderForm';

const STATUSES = ['pending', 'fired', 'dismissed'] as const;

export function RemindersPage() {
  const [status, setStatus] = useState('pending');
  const [editing, setEditing] = useState<ReminderRow | null>(); // undefined: closed, null: adding
  // ponytail: list_reminders returns at most 200 (oldest first); page by from/to if a view ever holds more.
  const read = useCallback(() => api.data.read<ReminderRow[]>('list_reminders', { status }), [status]);
  const { data: reminders, loading, busy, write, remove, holders } = useData(read, []);
  const { t } = useTranslation(['pages', 'common']);

  const groups = new Map<string, ReminderRow[]>(); // local date -> rows, in remind_at order
  for (const r of reminders) {
    const day = toLocalDate(new Date(r.remind_at));
    groups.set(day, [...(groups.get(day) ?? []), r]);
  }

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title={t('common:nav.reminders')}
        sticky={false}
        actions={
          <Space wrap>
            <Radio.Group
              type='button'
              value={status}
              onChange={setStatus}
              options={[...STATUSES.map((s) => ({ label: t(`reminderStatus.${s}`), value: s })), { label: t('all'), value: 'all' }]}
            />
            <Button type='primary' icon={<Plus />} onClick={() => setEditing(null)}>
              {t('common:add')}
            </Button>
          </Space>
        }
      />
      {loading && <Skeleton />}
      {!loading && !reminders.length && <Empty description={t('noReminders')} />}
      {[...groups].map(([day, list]) => (
        <section key={day}>
          <div className='group-title'>
            {parseLocalDate(day).toLocaleDateString('vi-VN')} <span className='count'>{list.length}</span>
          </div>
          {list.map((r) => (
            <div key={r.id} className={r.status === 'pending' ? 'row' : 'row is-closed'}>
              <span className='muted'>{toLocalTime(new Date(r.remind_at))}</span>
              <div className='row-main'>
                <button type='button' className='link' onClick={() => setEditing(r)}>
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
