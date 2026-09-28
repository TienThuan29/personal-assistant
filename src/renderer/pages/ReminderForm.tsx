import { DatePicker, Form, Input } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, toLocalDate, toLocalMinute } from '../../shared/dates';
import { diffPatch } from '../../shared/patch';
import type { ReminderRow } from '../../shared/types';
import { api, errorText } from '../api';
import { RecordModal } from '../components/RecordModal';

/** `remind_at` as local 'YYYY-MM-DDTHH:mm', unlike ReminderRow's UTC instant. */
type Fields = Pick<ReminderRow, 'message' | 'remind_at'>;

const nextHour = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toLocalMinute(d);
};

/** Add (`reminder` null) or edit a reminder. Reminders have no images. */
export function ReminderForm({ reminder, onClose }: { reminder: ReminderRow | null; onClose: () => void }) {
  const { t } = useTranslation(['pages', 'common', 'chat', 'errors']);
  const [form] = Form.useForm<Fields>();
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = { required: true, message: t('common:required') };

  // Compared in the form's own format, so an untouched time (maybe past, for a fired reminder) stays out of the patch.
  const before = reminder && { ...reminder, remind_at: toLocalMinute(new Date(reminder.remind_at)) };
  const initial: Partial<Fields> = before ?? { remind_at: nextHour() };

  const save = async () => {
    let v: Fields;
    try {
      v = await form.validate();
    } catch {
      return; // the form shows what is missing
    }
    const values = { message: v.message.trim(), remind_at: v.remind_at };
    setSaving(true);
    setError(null);
    try {
      if (!before) await api.data.save('create_reminder', values);
      else {
        const patch = diffPatch(before, values);
        if (Object.keys(patch).length) await api.data.save('update_reminders', { ids: [before.id], patch });
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
      title={t(reminder ? 'editReminder' : 'addReminder')}
      visible
      dirty={changed}
      saving={saving}
      error={error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <Form form={form} layout='vertical' initialValues={initial} onValuesChange={() => setChanged(true)}>
        <Form.Item
          field='message'
          label={t('chat:field.message')}
          rules={[required, { validator: (v: string | undefined, cb) => cb(v && !v.trim() ? t('common:required') : undefined) }]}
        >
          <Input.TextArea autoFocus autoSize={{ minRows: 2 }} />
        </Form.Item>
        <Form.Item
          field='remind_at'
          label={t('chat:field.remind_at')}
          rules={[
            required,
            {
              validator: (v: string | null | undefined, cb) =>
                cb(v && v !== before?.remind_at && new Date(v).getTime() <= Date.now() ? t('errors:reminderPast') : undefined),
            },
          ]}
          formatter={(v?: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11)}` : undefined)}
          getValueFromEvent={(s?: string) => (s ? `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}T${s.slice(11)}` : null)}
        >
          <DatePicker
            showTime
            format='DD/MM/YYYY HH:mm'
            allowClear={false}
            disabledDate={(d) => d.valueOf() < parseLocalDate(toLocalDate()).getTime()}
            disabledTime={(d) => {
              const now = new Date();
              if (!d || toLocalDate(d.toDate()) !== toLocalDate(now)) return {};
              const upTo = (n: number) => Array.from({ length: n }, (_, i) => i);
              return { disabledHours: () => upTo(now.getHours()), disabledMinutes: () => (d.hour() === now.getHours() ? upTo(now.getMinutes() + 1) : []) };
            }}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </RecordModal>
  );
}
