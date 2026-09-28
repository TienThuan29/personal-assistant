import { SettingsPageHeader } from '@aionui/ui';
import { Button, Checkbox, Empty, Radio, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, recurrenceText, toLocalDate } from '../../shared/dates';
import type { TaskRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Skeleton, useData } from '../useData';

const dueText = (t: TaskRow) =>
  [t.due_date && parseLocalDate(t.due_date).toLocaleDateString('vi-VN'), t.due_time].filter(Boolean).join(' ');

export function TasksPage() {
  const [category, setCategory] = useState('all');
  const read = useCallback(() => api.data.read<TaskRow[]>('list_tasks', category === 'all' ? {} : { category }), [category]);
  const { data: tasks, loading, busy, write, remove, holders } = useData(read, []);
  const { t } = useTranslation(['pages', 'common']);
  const categories = t('common:category', { returnObjects: true }) as Record<string, string>;
  const priorityTags = { 1: <Tag color='red'>{t('priorityHigh')}</Tag>, 2: null, 3: <Tag>{t('priorityLow')}</Tag> };

  const today = toLocalDate();
  const groups = [
    ['overdue', tasks.filter((x) => x.due_date && x.due_date < today)],
    ['today', tasks.filter((x) => x.due_date === today)],
    ['upcoming', tasks.filter((x) => x.due_date && x.due_date > today)],
    ['noDate', tasks.filter((x) => !x.due_date)],
  ] as const;

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title={t('common:nav.tasks')}
        sticky={false}
        description={t('tasksHint')}
        actions={
          <Radio.Group
            type='button'
            value={category}
            onChange={setCategory}
            options={[
              { label: t('all'), value: 'all' },
              { label: categories.work, value: 'work' },
              { label: categories.personal, value: 'personal' },
            ]}
          />
        }
      />
      {loading && <Skeleton />}
      {!loading && !tasks.length && <Empty description={t('noTasks')} />}
      {groups
        .filter(([, list]) => list.length)
        .map(([group, list]) => (
          <section key={group}>
            <div className='group-title'>
              {t(group)} <span className='count'>{list.length}</span>
            </div>
            {list.map((task) => (
              <div key={task.id} className={busy.includes(task.id) ? 'row is-done' : 'row'}>
                <Checkbox
                  aria-label={t('complete', { title: task.title })}
                  checked={busy.includes(task.id)}
                  disabled={busy.includes(task.id)}
                  onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
                />
                <div className='row-main'>
                  {task.title}
                  {task.recurrence && <span className='muted'> · {recurrenceText(task.recurrence, t)}</span>}
                  {task.notes && <div className='muted'>{task.notes}</div>}
                  <Thumbs ids={task.attachment_ids} />
                </div>
                <span className={group === 'overdue' ? 'overdue' : 'muted'}>{dueText(task)}</span>
                {priorityTags[task.priority]}
                <Tag>{categories[task.category] ?? task.category}</Tag>
                <Button
                  size='mini'
                  type='text'
                  status='danger'
                  icon={<Delete />}
                  aria-label={t('deleteTask', { what: task.title })}
                  disabled={busy.includes(task.id)}
                  onClick={() => remove(task.id, 'delete_tasks', task.title)}
                />
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}
