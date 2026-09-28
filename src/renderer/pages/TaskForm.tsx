import { Checkbox, DatePicker, Form, Input, InputNumber, Select, TimePicker } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRecurrence, parseRecurrence, type RecurrenceForm } from '../../shared/dates';
import { diffPatch } from '../../shared/patch';
import type { TaskRow } from '../../shared/types';
import { api, errorText, splitIds } from '../api';
import { ImageField } from '../components/ImageField';
import { RecordModal } from '../components/RecordModal';
import { useImagePicker } from '../components/useImagePicker';

type Fields = Pick<TaskRow, 'title' | 'notes' | 'category' | 'priority' | 'due_date' | 'due_time' | 'status'> & {
  rec_kind: RecurrenceForm['kind'];
  rec_days?: number[];
  rec_day?: number;
};

/** Add (`task` null) or edit a task; `categories` = the category options besides work/personal. */
export function TaskForm({ task, categories, onClose }: { task: TaskRow | null; categories: string[]; onClose: () => void }) {
  const { t } = useTranslation(['pages', 'common', 'chat']);
  const [form] = Form.useForm<Fields>();
  const picker = useImagePicker();
  const [removed, setRemoved] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recKind = Form.useWatch('rec_kind', form);
  const labels = t('common:category', { returnObjects: true }) as Record<string, string>;
  const required = [{ required: true, message: t('common:required') }];

  const rec = parseRecurrence(task?.recurrence ?? null);
  const initial: Partial<Fields> = task
    ? { ...task, rec_kind: rec.kind, rec_days: rec.weekdays, rec_day: rec.day }
    : { category: 'personal', priority: 2, rec_kind: 'none', rec_day: 1 };

  const save = async () => {
    let v: Fields;
    try {
      v = await form.validate();
    } catch {
      return; // the form shows what is missing
    }
    const values: Record<string, unknown> = {
      title: v.title,
      notes: v.notes,
      category: v.category,
      priority: v.priority,
      due_date: v.due_date,
      due_time: v.due_time,
      recurrence: formatRecurrence({ kind: v.rec_kind, weekdays: v.rec_days ?? [], day: v.rec_day ?? 1 }),
      ...(task && { status: v.status }),
    };
    setSaving(true);
    setError(null);
    try {
      const images = await picker.toInputs();
      if (!task) {
        await api.data.save('create_task', Object.fromEntries(Object.entries(values).filter(([, x]) => x !== '' && x != null)), images);
      } else {
        const patch = diffPatch(task, values);
        if (Object.keys(patch).length || images.length || removed.length)
          await api.data.save('update_tasks', { ids: [task.id], patch }, images, removed);
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordModal
      title={t(task ? 'editTask' : 'addTask')}
      visible
      dirty={changed || picker.images.length > 0 || removed.length > 0}
      saving={saving}
      error={error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <Form form={form} layout='vertical' initialValues={initial} onValuesChange={() => setChanged(true)}>
        <Form.Item field='title' label={t('chat:field.title')} rules={required}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item field='notes' label={t('chat:field.notes')}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
        <div className='form-row'>
          <Form.Item field='category' label={t('chat:field.category')} rules={required}>
            <Select
              allowCreate
              showSearch
              options={[...new Set(['work', 'personal', ...categories])].map((c) => ({ label: labels[c] ?? c, value: c }))}
            />
          </Form.Item>
          <Form.Item field='priority' label={t('chat:field.priority')}>
            <Select options={[1, 2, 3].map((p) => ({ label: t(`chat:value.priority.${p as 1}`), value: p }))} />
          </Form.Item>
          {task && (
            <Form.Item field='status' label={t('chat:field.status')}>
              <Select options={(['todo', 'done', 'cancelled'] as const).map((s) => ({ label: t(`status.${s}`), value: s }))} />
            </Form.Item>
          )}
        </div>
        <div className='form-row'>
          <Form.Item
            field='due_date'
            label={t('chat:field.due_date')}
            formatter={(v?: string | null) => (v ? v.split('-').reverse().join('/') : undefined)}
            getValueFromEvent={(s?: string) => (s ? s.split('/').reverse().join('-') : null)}
          >
            <DatePicker format='DD/MM/YYYY' style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item field='due_time' label={t('chat:field.due_time')} getValueFromEvent={(s?: string) => s || null}>
            <TimePicker format='HH:mm' style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className='form-row'>
          <Form.Item field='rec_kind' label={t('chat:field.recurrence')}>
            <Select
              options={[
                { label: t('recurNone'), value: 'none' },
                { label: t('common:recurDaily'), value: 'daily' },
                { label: t('recurWeekly'), value: 'weekly' },
                { label: t('recurMonthly'), value: 'monthly' },
              ]}
            />
          </Form.Item>
          {recKind === 'weekly' && (
            <Form.Item field='rec_days' label=' ' rules={required} requiredSymbol={false}>
              <Checkbox.Group options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ label: t(`common:weekday.${d as 1}`), value: d }))} />
            </Form.Item>
          )}
          {recKind === 'monthly' && (
            <Form.Item field='rec_day' label={t('recurDay')} rules={required} requiredSymbol={false}>
              <InputNumber min={1} max={31} precision={0} />
            </Form.Item>
          )}
        </div>
        <Form.Item label={t('common:image')}>
          <ImageField
            existing={splitIds(task?.attachment_ids)}
            removed={removed}
            onToggleRemove={(id) => setRemoved((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))}
            picker={picker}
          />
        </Form.Item>
      </Form>
    </RecordModal>
  );
}
