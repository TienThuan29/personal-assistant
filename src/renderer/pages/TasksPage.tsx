import { SettingsPageHeader } from '@aionui/ui';
import { Button, Checkbox, Empty, Radio, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { parseLocalDate, recurrenceText, toLocalDate } from '../../shared/dates';
import type { TaskRow } from '../../shared/types';
import { api } from '../api';
import { Thumbs } from '../components/Thumbs';
import { useData } from '../useData';

const CATEGORY_LABELS: Record<string, string> = { work: 'Công việc', personal: 'Cá nhân' };
const PRIORITY_TAGS = { 1: <Tag color='red'>Ưu tiên cao</Tag>, 2: null, 3: <Tag>Ưu tiên thấp</Tag> };

const dueText = (t: TaskRow) =>
  [t.due_date && parseLocalDate(t.due_date).toLocaleDateString('vi-VN'), t.due_time].filter(Boolean).join(' ');

export function TasksPage() {
  const [category, setCategory] = useState('all');
  const read = useCallback(() => api.data.read<TaskRow[]>('list_tasks', category === 'all' ? {} : { category }), [category]);
  const { data: tasks, busy, write, remove, holders } = useData(read, []);

  const today = toLocalDate();
  const groups: [string, TaskRow[]][] = [
    ['Quá hạn', tasks.filter((t) => t.due_date && t.due_date < today)],
    ['Hôm nay', tasks.filter((t) => t.due_date === today)],
    ['Sắp tới', tasks.filter((t) => t.due_date && t.due_date > today)],
    ['Chưa có ngày', tasks.filter((t) => !t.due_date)],
  ];

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title='Task'
        sticky={false}
        description='Tick để hoàn thành. Muốn thêm hoặc sửa, hãy nhắn cho trợ lý.'
        actions={
          <Radio.Group
            type='button'
            value={category}
            onChange={setCategory}
            options={[
              { label: 'Tất cả', value: 'all' },
              { label: 'Công việc', value: 'work' },
              { label: 'Cá nhân', value: 'personal' },
            ]}
          />
        }
      />
      {!tasks.length && <Empty description='Không có task nào' />}
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <section key={title}>
            <div className='group-title'>
              {title} ({list.length})
            </div>
            {list.map((t) => (
              <div key={t.id} className='row'>
                <Checkbox
                  aria-label={`Hoàn thành: ${t.title}`}
                  checked={busy.includes(t.id)}
                  disabled={busy.includes(t.id)}
                  onChange={() => void write(t.id, 'update_tasks', { ids: [t.id], patch: { status: 'done' } })}
                />
                <div className='row-main'>
                  {t.title}
                  {t.recurrence && <span className='muted'> · {recurrenceText(t.recurrence)}</span>}
                  {t.notes && <div className='muted'>{t.notes}</div>}
                  <Thumbs ids={t.attachment_ids} />
                </div>
                <span className={title === 'Quá hạn' ? 'overdue' : 'muted'}>{dueText(t)}</span>
                {PRIORITY_TAGS[t.priority]}
                <Tag>{CATEGORY_LABELS[t.category] ?? t.category}</Tag>
                <Button
                  size='mini'
                  type='text'
                  status='danger'
                  icon={<Delete />}
                  aria-label={`Xóa task: ${t.title}`}
                  disabled={busy.includes(t.id)}
                  onClick={() => remove(t.id, 'delete_tasks', t.title)}
                />
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}
