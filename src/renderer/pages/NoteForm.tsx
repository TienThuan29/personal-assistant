import { Form, Input, Radio } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffPatch } from '../../shared/patch';
import type { NoteRow } from '../../shared/types';
import { api, errorText, splitIds } from '../api';
import { ImageField } from '../components/ImageField';
import { RecordModal } from '../components/RecordModal';
import { useImagePicker } from '../components/useImagePicker';

type Fields = Pick<NoteRow, 'kind' | 'title'> & { body: string };

/** Add (`note` null) or edit a note; `note` must carry the full `body` (get_notes). */
export function NoteForm({ note, onClose }: { note: NoteRow | null; onClose: () => void }) {
  const { t } = useTranslation(['pages', 'common', 'chat']);
  const [form] = Form.useForm<Fields>();
  const picker = useImagePicker();
  const [removed, setRemoved] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial: Partial<Fields> = note ? { kind: note.kind, title: note.title ?? '', body: note.body ?? '' } : { kind: 'note' };

  const save = async () => {
    let v: Fields;
    try {
      v = await form.validate();
    } catch {
      return; // the form shows what is missing
    }
    const values: Record<string, unknown> = { kind: v.kind, title: v.title, body: v.body };
    setSaving(true);
    setError(null);
    try {
      const images = await picker.toInputs();
      if (!note) {
        await api.data.save('create_note', Object.fromEntries(Object.entries(values).filter(([, x]) => x !== '' && x != null)), images);
      } else {
        const patch = diffPatch(note, values);
        if (Object.keys(patch).length || images.length || removed.length)
          await api.data.save('update_notes', { ids: [note.id], patch }, images, removed);
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
      title={t(note ? 'editNote' : 'addNote')}
      visible
      dirty={changed || picker.images.length > 0 || removed.length > 0}
      saving={saving}
      error={error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <Form form={form} layout='vertical' initialValues={initial} onValuesChange={() => setChanged(true)}>
        <Form.Item field='kind' label={t('chat:field.kind')}>
          <Radio.Group
            type='button'
            options={(['note', 'journal'] as const).map((k) => ({ label: t(`chat:value.kind.${k}`), value: k }))}
          />
        </Form.Item>
        <Form.Item field='title' label={t('chat:field.title')}>
          <Input />
        </Form.Item>
        <Form.Item field='body' label={t('chat:field.body')} rules={[{ required: true, message: t('common:required') }]}>
          <Input.TextArea autoFocus autoSize={{ minRows: 8 }} />
        </Form.Item>
        <Form.Item label={t('common:image')}>
          <ImageField
            existing={splitIds(note?.attachment_ids)}
            removed={removed}
            onToggleRemove={(id) => setRemoved((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))}
            picker={picker}
          />
        </Form.Item>
      </Form>
    </RecordModal>
  );
}
