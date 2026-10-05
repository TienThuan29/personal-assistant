import { Button, Checkbox, Radio } from '@arco-design/web-react';
import { CheckOne, Plus, Refresh } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, recurrenceText, toLocalDate } from '../../shared/dates';
import type { TaskRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Card, Chip, EmptyState, PageToolbar, RowActions } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { TaskForm } from './TaskForm';

const dueText = (t: TaskRow) =>
  [t.due_date && parseLocalDate(t.due_date).toLocaleDateString('vi-VN'), t.due_time].filter(Boolean).join(' ');

export function TasksPage() {
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('todo');
  const [editing, setEditing] = useState<TaskRow | null>(); // undefined: closed, null: adding
  const read = useCallback(
    () => api.data.read<TaskRow[]>('list_tasks', category === 'all' ? { status } : { status, category }),
    [category, status]
  );
  const { data: tasks, loading, busy, write, remove, holders } = useData(read, []);
  const { t } = useTranslation(['pages', 'common']);
  const categories = t('common:category', { returnObjects: true }) as Record<string, string>;
  const priorityChips = { 1: <Chip tone='danger'>{t('priorityHigh')}</Chip>, 2: null, 3: <Chip>{t('priorityLow')}</Chip> };

  const today = toLocalDate();
  // Closed and mixed views are one flat list; only open tasks group by due date.
  const groups = status !== 'todo' ? ([['', tasks]] as const) : ([
    ['overdue', tasks.filter((x) => x.due_date && x.due_date < today)],
    ['today', tasks.filter((x) => x.due_date === today)],
    ['upcoming', tasks.filter((x) => x.due_date && x.due_date > today)],
    ['noDate', tasks.filter((x) => !x.due_date)],
  ] as const);

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
          options={[...(['todo', 'done', 'cancelled'] as const).map((s) => ({ label: t(`status.${s}`), value: s })), { label: t('all'), value: 'all' }]}
        />
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
        {addButton}
      </PageToolbar>
      {loading && <Skeleton />}
      {!loading && !tasks.length && (
        <EmptyState icon={<CheckOne />} title={t('noTasks')} hint={t('noTasksHint')}>
          {addButton}
        </EmptyState>
      )}
      <div className='flex flex-col gap-4'>
        {groups
          .filter(([, list]) => list.length)
          .map(([group, list]) => (
            <Card key={group} title={group && t(group)} count={list.length}>
              {list.map((task) => {
                const closed = task.status !== 'todo';
                const isBusy = busy.includes(task.id);
                const overdue = !closed && !!task.due_date && task.due_date < today;
                const due = dueText(task);
                return (
                  <div key={task.id} className={isBusy ? 'list-row is-done' : closed ? 'list-row is-closed' : 'list-row'}>
                    <Checkbox
                      aria-label={t('complete', { title: task.title })}
                      checked={closed || isBusy}
                      disabled={closed || isBusy}
                      onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
                    />
                    <div className='row-main flex flex-col items-start gap-1'>
                      <button type='button' className='link' disabled={isBusy} onClick={() => setEditing(task)}>
                        {task.title}
                      </button>
                      <div className='flex flex-wrap gap-1.5'>
                        {due && <Chip tone={overdue ? 'danger' : 'neutral'}>{overdue && !group ? `${t('overdue')} · ${due}` : due}</Chip>}
                        {priorityChips[task.priority]}
                        <Chip icon={<span className='w-1.5 h-1.5 rounded-full bg-current' />}>{categories[task.category] ?? task.category}</Chip>
                        {task.recurrence && <Chip icon={<Refresh />}>{recurrenceText(task.recurrence, t)}</Chip>}
                      </div>
                      {task.notes && <div className='text-ink-2 text-[13px] line-clamp-2'>{task.notes}</div>}
                      <Thumbs ids={task.attachment_ids} />
                    </div>
                    <RowActions editLabel={t('editTaskLabel', { what: task.title })} deleteLabel={t('deleteTask', { what: task.title })} disabled={isBusy} onEdit={() => setEditing(task)} onDelete={() => remove(task.id, 'delete_tasks', task.title)} />
                  </div>
                );
              })}
            </Card>
          ))}
      </div>
      {editing !== undefined && (
        <TaskForm task={editing} categories={tasks.map((x) => x.category)} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
