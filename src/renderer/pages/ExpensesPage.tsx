import { SettingsPageHeader } from '@aionui/ui';
import { Button, DatePicker, Space, Table, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, toLocalDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { ExpenseList, ExpenseRow } from '../../shared/types';
import { api, useUiSettings } from '../api';
import { Thumbs } from '../components/Thumbs';
import { useData } from '../useData';

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};

export function ExpensesPage() {
  const { t } = useTranslation(['pages', 'common']);
  const { moneyStyle } = useUiSettings();
  const money = (amount: number, currency: string) => formatMoney(amount, currency, moneyStyle);
  const [month, setMonth] = useState(() => toLocalDate().slice(0, 7));
  const read = useCallback(() => api.data.read<ExpenseList>('list_expenses', monthRange(month)), [month]);
  const { data, busy, remove, holders } = useData<ExpenseList>(read, { items: [], totals: [] });

  const byCategory = new Map<string, { category: string; currency: string; total: number }>();
  for (const e of data.items) {
    const key = `${e.category}|${e.currency}`;
    byCategory.set(key, { category: e.category, currency: e.currency, total: (byCategory.get(key)?.total ?? 0) + e.amount });
  }

  const columns = [
    { title: t('date'), dataIndex: 'spent_at', width: 110, render: (v: string) => parseLocalDate(v).toLocaleDateString('vi-VN') },
    { title: t('category'), dataIndex: 'category', width: 140 },
    { title: t('description'), dataIndex: 'description', render: (v: string | null) => v || '—' },
    { title: t('amount'), dataIndex: 'amount', align: 'right' as const, render: (_: number, r: ExpenseRow) => money(r.amount, r.currency) },
    { title: t('image'), dataIndex: 'attachment_ids', render: (v: string | null) => <Thumbs ids={v} /> },
    {
      title: '',
      dataIndex: 'id',
      width: 48,
      render: (id: number, r: ExpenseRow) => (
        <Button
          size='mini'
          type='text'
          status='danger'
          icon={<Delete />}
          aria-label={t('deleteExpense', { what: r.description || r.category })}
          disabled={busy.includes(id)}
          onClick={() => remove(id, 'delete_expenses', `${r.description || r.category}: ${money(r.amount, r.currency)}`)}
        />
      ),
    },
  ];

  return (
    <div className='page'>
      {holders}
      <SettingsPageHeader
        title={t('common:nav.expenses')}
        sticky={false}
        description={data.totals.length ? t('total', { amount: data.totals.map((x) => money(x.total, x.currency)).join(' + ') }) : t('noExpenses')}
        actions={
          <DatePicker.MonthPicker
            aria-label={t('month')}
            format='MM/YYYY'
            value={`${month.slice(5)}/${month.slice(0, 4)}`}
            allowClear={false}
            onChange={(v: string) => v && setMonth(`${v.slice(3)}-${v.slice(0, 2)}`)}
          />
        }
      />
      <Space wrap style={{ marginBottom: 16 }}>
        {[...byCategory.values()]
          .sort((a, b) => b.total - a.total)
          .map((v) => (
            <Tag key={`${v.category}|${v.currency}`}>
              {v.category}: {money(v.total, v.currency)}
            </Tag>
          ))}
      </Space>
      <Table rowKey='id' columns={columns} data={data.items} pagination={false} />
    </div>
  );
}
