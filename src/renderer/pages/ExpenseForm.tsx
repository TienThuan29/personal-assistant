import { AutoComplete, DatePicker, Form, Input, InputNumber } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toLocalDate } from '../../shared/dates';
import { fromMinor, minorDigits, toMinor } from '../../shared/money';
import { diffPatch } from '../../shared/patch';
import type { ExpenseRow } from '../../shared/types';
import { api, errorText, splitIds, useUiSettings } from '../api';
import { ImageField } from '../components/ImageField';
import { RecordModal } from '../components/RecordModal';
import { useImagePicker } from '../components/useImagePicker';

/** `amount` in the currency's major unit (12.5 USD), unlike ExpenseRow. */
type Fields = Pick<ExpenseRow, 'amount' | 'currency' | 'category' | 'description' | 'spent_at'>;

/** Add (`expense` null) or edit an expense; `categories` = the suggestions for the category field. */
export function ExpenseForm({ expense, categories, onClose }: { expense: ExpenseRow | null; categories: string[]; onClose: () => void }) {
  const { t } = useTranslation(['pages', 'common', 'chat', 'errors']);
  const { defaultCurrency } = useUiSettings();
  const [form] = Form.useForm<Fields>();
  const picker = useImagePicker();
  const [removed, setRemoved] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The amount keeps its major-unit number when the currency changes; it is shown and saved rounded to the new precision.
  const currency: string = Form.useWatch('currency', form) ?? '';
  const required = { required: true, message: t('common:required') };

  const initial: Partial<Fields> = expense
    ? { ...expense, amount: fromMinor(expense.amount, expense.currency), description: expense.description ?? '' }
    : { currency: defaultCurrency, spent_at: toLocalDate() };

  const save = async () => {
    let v: Fields;
    try {
      v = await form.validate();
    } catch {
      return; // the form shows what is missing
    }
    const values: Record<string, unknown> = {
      amount: toMinor(v.amount, v.currency),
      currency: v.currency,
      category: v.category.trim(),
      description: v.description,
      spent_at: v.spent_at,
    };
    setSaving(true);
    setError(null);
    try {
      const images = await picker.toInputs();
      if (!expense) {
        await api.data.save('create_expense', Object.fromEntries(Object.entries(values).filter(([, x]) => x !== '' && x != null)), images);
      } else {
        // Both sides in minor units, so an untouched amount stays out of the patch.
        const patch = diffPatch(expense, values);
        if (Object.keys(patch).length || images.length || removed.length)
          await api.data.save('update_expenses', { ids: [expense.id], patch }, images, removed);
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
      title={t(expense ? 'editExpense' : 'addExpense')}
      visible
      dirty={changed || picker.images.length > 0 || removed.length > 0}
      saving={saving}
      error={error}
      onSave={() => void save()}
      onClose={onClose}
    >
      <Form form={form} layout='vertical' initialValues={initial} onValuesChange={() => setChanged(true)}>
        <div className='form-row'>
          <Form.Item
            field='amount'
            label={t('chat:field.amount')}
            rules={[required, { validator: (v: number | undefined, cb) => cb(v && toMinor(v, currency) > 0 ? undefined : t('amountPositive')) }]}
          >
            <InputNumber autoFocus min={0} precision={minorDigits(currency)} />
          </Form.Item>
          <Form.Item
            field='currency'
            label={t('chat:field.currency')}
            normalize={(v?: string) => v?.toUpperCase()}
            rules={[required, { match: /^[A-Z]{3}$/, message: t('errors:currencyFormat') }]}
          >
            <Input maxLength={3} />
          </Form.Item>
        </div>
        <div className='form-row'>
          <Form.Item field='category' label={t('categoryColumn')} rules={[required]}>
            <AutoComplete data={[...new Set(categories)]} />
          </Form.Item>
          <Form.Item
            field='spent_at'
            label={t('chat:field.spent_at')}
            rules={[required]}
            formatter={(v?: string | null) => (v ? v.split('-').reverse().join('/') : undefined)}
            getValueFromEvent={(s?: string) => (s ? s.split('/').reverse().join('-') : null)}
          >
            <DatePicker format='DD/MM/YYYY' allowClear={false} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item field='description' label={t('chat:field.description')}>
          <Input />
        </Form.Item>
        <Form.Item label={t('common:image')}>
          <ImageField
            existing={splitIds(expense?.attachment_ids)}
            removed={removed}
            onToggleRemove={(id) => setRemoved((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))}
            picker={picker}
          />
        </Form.Item>
      </Form>
    </RecordModal>
  );
}
