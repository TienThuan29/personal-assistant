import { CircleCheck, Plus, Repeat } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recurrenceText, toLocalDate } from '../../shared/dates';
import type { TaskRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { Btn, Chip, EmptyState, dayTitle, GroupLabel, ICON, PageBody, PageHeader, RoundCheck, RowActions, Segmented } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { TaskForm } from './TaskForm';

type View = 'todo' | 'today' | 'upcoming' | 'done' | 'cancelled' | 'all';

export function TasksPage({ initialEdit }: { initialEdit?: TaskRow }) {
  const [view, setView] = useState<View>('todo');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<TaskRow | null | undefined>(initialEdit); // undefined: closed, null: adding
  // Today and Upcoming are views of the open tasks, cut by date here.
  const status = view === 'today' || view === 'upcoming' ? 'todo' : view;
  const read = useCallback(
    () => api.data.read<TaskRow[]>('list_tasks', category === 'all' ? { status } : { status, category }),
    [category, status]
  );
  const { data: all, loading, busy, write, remove, holders } = useData(read, []);
  const { t } = useTranslation(['pages', 'common']);
  const categories = t('common:category', { returnObjects: true }) as Record<string, string>;

  const today = toLocalDate();
  const tasks = view === 'today' ? all.filter((x) => x.due_date === today) : view === 'upcoming' ? all.filter((x) => x.due_date && x.due_date > today) : all;
  // Closed and mixed views are one flat list; only open tasks group by due date.
  const grouped = view === 'todo';
  const groups = grouped
    ? ([
        ['overdue', tasks.filter((x) => x.due_date && x.due_date < today)],
        ['today', tasks.filter((x) => x.due_date === today)],
        ['upcoming', tasks.filter((x) => x.due_date && x.due_date > today)],
        ['noDate', tasks.filter((x) => !x.due_date)],
      ] as const)
    : ([['', tasks]] as const);

  const addButton = (
    <Btn variant='primary' icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
      {t('addTask')}
    </Btn>
  );

  const row = (task: TaskRow) => {
    const closed = task.status !== 'todo';
    const isBusy = busy.includes(task.id);
    const overdue = !closed && !!task.due_date && task.due_date < today;
    const due = task.due_date ? [dayTitle(task.due_date, t), task.due_time].filter(Boolean).join(' · ') : '';
    return (
      <div key={task.id} className={`list-row ${isBusy ? 'is-done' : closed ? 'is-closed' : ''}`}>
        <RoundCheck
          checked={closed || isBusy}
          disabled={closed || isBusy}
          urgent={task.priority === 1}
          label={t('complete', { title: task.title })}
          onChange={() => void write(task.id, 'update_tasks', { ids: [task.id], patch: { status: 'done' } })}
        />
        <div className='row-main flex flex-col items-start gap-1'>
          <button type='button' className='link text-sm font-400 text-left' disabled={isBusy} onClick={() => setEditing(task)}>
            {task.title}
          </button>
          {task.notes && <div className='text-ink-2 text-[13px] line-clamp-2'>{task.notes}</div>}
          <Thumbs ids={task.attachment_ids} />
        </div>
        {task.priority === 1 && <Chip tone='danger'>{t('priorityHigh')}</Chip>}
        {task.priority === 3 && <Chip>{t('priorityLow')}</Chip>}
        {task.recurrence && <Chip icon={<Repeat {...ICON} />}>{recurrenceText(task.recurrence, t)}</Chip>}
        <Chip>{categories[task.category] ?? task.category}</Chip>
        <span className={`min-w-24 text-right text-xs whitespace-nowrap ${overdue ? 'text-danger' : 'text-ink-3'}`}>{due}</span>
        <RowActions
          editLabel={t('editTaskLabel', { what: task.title })}
          deleteLabel={t('deleteTask', { what: task.title })}
          disabled={isBusy}
          onEdit={() => setEditing(task)}
          onDelete={() => remove(task.id, 'delete_tasks', task.title)}
        />
      </div>
    );
  };

  return (
    <PageBody max={920}>
      {holders}
      <PageHeader title={t('common:nav.tasks')} meta={view === 'todo' ? `${all.length} ${t('open')}` : undefined}>
        <Segmented
          label={t('viewLabel')}
          value={view}
          onChange={setView}
          options={[
            { value: 'todo', label: t('open') },
            { value: 'today', label: t('today') },
            { value: 'upcoming', label: t('upcoming') },
            { value: 'done', label: t('status.done') },
            { value: 'cancelled', label: t('status.cancelled') },
            { value: 'all', label: t('all') },
          ]}
        />
        {addButton}
      </PageHeader>
      <Segmented
        className='self-start'
        label={t('categoryLabel')}
        value={category}
        onChange={setCategory}
        options={[
          { value: 'all', label: t('all') },
          { value: 'work', label: categories.work },
          { value: 'personal', label: categories.personal },
        ]}
      />
      {loading && <Skeleton />}
      {!loading && !tasks.length && (
        <EmptyState icon={<CircleCheck {...ICON} />} title={t('noTasks')} hint={t('noTasksHint')}>
          {addButton}
        </EmptyState>
      )}
      {groups
        .filter(([, list]) => list.length)
        .map(([group, list]) => (
          <section key={group} className='flex flex-col gap-2'>
            {group && (
              <GroupLabel count={list.length} tone={group === 'overdue' ? 'danger' : undefined}>
                {t(group)}
              </GroupLabel>
            )}
            <div className='border border-solid border-line rounded-card overflow-hidden'>{list.map(row)}</div>
          </section>
        ))}
      {editing !== undefined && <TaskForm task={editing} categories={all.map((x) => x.category)} onClose={() => setEditing(undefined)} />}
    </PageBody>
  );
}
