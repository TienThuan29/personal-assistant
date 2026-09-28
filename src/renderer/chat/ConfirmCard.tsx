import { Alert, Button, Input, InputNumber, Select, Space, Tag } from '@arco-design/web-react';
import { useState } from 'react';
import { parseLocalDate, recurrenceText } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { PendingAction } from '../../shared/types';
import { Thumbs } from '../components/Thumbs';

const TITLES: Record<string, string> = {
  create_task: 'Tạo task',
  update_tasks: 'Sửa task',
  delete_tasks: 'Xóa task',
  create_reminder: 'Tạo nhắc nhở',
  update_reminders: 'Sửa nhắc nhở',
  delete_reminders: 'Xóa nhắc nhở',
  create_note: 'Tạo ghi chú',
  update_notes: 'Sửa ghi chú',
  delete_notes: 'Xóa ghi chú',
  create_expense: 'Ghi khoản chi',
  update_expenses: 'Sửa khoản chi',
  delete_expenses: 'Xóa khoản chi',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Tiêu đề',
  notes: 'Ghi chú',
  category: 'Phân loại',
  priority: 'Ưu tiên',
  due_date: 'Ngày',
  due_time: 'Giờ',
  recurrence: 'Lặp lại',
  status: 'Trạng thái',
  message: 'Nội dung',
  remind_at: 'Thời điểm',
  task_id: 'Task #',
  kind: 'Loại',
  body: 'Nội dung',
  amount: 'Số tiền',
  currency: 'Tiền tệ',
  description: 'Mô tả',
  spent_at: 'Ngày chi',
};

/** Display names of enum values; `kind` and `priority` are picked from these on the create card. */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  status: { todo: 'Chưa xong', done: 'Xong', cancelled: 'Đã hủy', dismissed: 'Bỏ qua' },
  kind: { note: 'Ghi chú', journal: 'Nhật ký' },
  category: { work: 'Công việc', personal: 'Cá nhân' },
  priority: { 1: 'Cao', 2: 'Thường', 3: 'Thấp' },
};
const SELECTS = new Set(['kind', 'priority']);
/** Single-line string fields; the others get an auto-growing textarea. */
const SHORT = new Set(['due_date', 'due_time', 'remind_at', 'spent_at', 'currency', 'category', 'recurrence']);

const STATUS = {
  pending: { color: 'arcoblue', text: 'Chờ xác nhận' },
  confirmed: { color: 'green', text: 'Đã thực hiện' },
  cancelled: { color: 'gray', text: 'Đã hủy' },
} as const;

type Row = Record<string, unknown> & { id: number };

const fmt = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  if (k === 'recurrence') return recurrenceText(s);
  if (VALUE_LABELS[k]?.[s]) return VALUE_LABELS[k][s];
  // Stored instants are UTC ISO; LLM-given ones are local 'YYYY-MM-DDTHH:MM'. Both parse correctly.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseLocalDate(s).toLocaleDateString('vi-VN');
  return s;
};
const cut = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const describe = (r: Row): string => {
  if (r.amount != null) return `${cut(String(r.description ?? r.category))} · ${formatMoney(Number(r.amount), String(r.currency))}`;
  if (r.remind_at) return `${cut(String(r.message))} · ${fmt('remind_at', r.remind_at)}`;
  return cut(String(r.title ?? r.body ?? ''));
};

export function ConfirmCard(props: {
  action: PendingAction;
  args: Record<string, unknown>;
  onArgsChange: (args: Record<string, unknown>) => void;
  onResolve: (decision: 'confirm' | 'cancel') => Promise<void>;
}) {
  const { action, args, onArgsChange, onResolve } = props;
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const pending = action.status === 'pending';
  const shown = pending ? args : action.args; // after resolution, what was actually stored
  const isCreate = action.tool_name.startsWith('create_');
  const before = (action.preview as { before?: Row[] } | null)?.before ?? [];
  const patch = (shown.patch ?? {}) as Record<string, unknown>;
  const error = (action.result as { error?: string } | null)?.error;
  const status = error ? { color: 'red', text: 'Thất bại' } : STATUS[action.status];
  const currency = String(shown.currency ?? 'VND');

  const resolve = async (d: 'confirm' | 'cancel') => {
    setBusy(d);
    try {
      await onResolve(d);
    } finally {
      setBusy(null);
    }
  };

  // Only fields the LLM filled are shown; the user can edit them but not add new ones.
  // The editor follows the original arg type, so a cleared number stays a number field; cleared = omitted.
  const editor = (k: string, v: unknown, label: string) => {
    const set = (x: unknown) => onArgsChange({ ...args, [k]: x === '' || x === null ? undefined : x });
    if (SELECTS.has(k)) {
      const options = Object.entries(VALUE_LABELS[k]).map(([value, text]) => ({
        label: text,
        value: typeof action.args[k] === 'number' ? Number(value) : value,
      }));
      return <Select aria-label={label} value={v as string | number | undefined} options={options} onChange={set} />;
    }
    if (typeof action.args[k] === 'number') {
      return (
        <Space>
          <InputNumber aria-label={label} value={v as number | undefined} onChange={set} />
          {k === 'amount' && typeof v === 'number' && <span className='muted'>{formatMoney(v, currency)}</span>}
        </Space>
      );
    }
    return SHORT.has(k) ? (
      <Input aria-label={label} value={String(v ?? '')} onChange={set} />
    ) : (
      <Input.TextArea aria-label={label} autoSize={{ minRows: 1, maxRows: 6 }} value={String(v ?? '')} onChange={set} />
    );
  };

  return (
    <div className='confirm-card'>
      <div className='confirm-title'>
        {TITLES[action.tool_name] ?? action.tool_name}
        <Tag color={status.color}>{status.text}</Tag>
      </div>

      {isCreate &&
        Object.entries(shown)
          .filter(([k]) => k !== 'attachment_ids')
          .map(([k, v]) => {
            const label = FIELD_LABELS[k] ?? k;
            return (
              <div key={k} className='confirm-row'>
                <span className='muted'>{label}</span>
                {pending ? (
                  editor(k, v, label)
                ) : (
                  <span className='confirm-value'>{k === 'amount' ? formatMoney(Number(v), currency) : fmt(k, v)}</span>
                )}
              </div>
            );
          })}

      {!isCreate &&
        before.map((row) => (
          <div key={row.id}>
            <div>
              #{row.id} {describe(row)}
            </div>
            {Object.entries(patch).map(([k, v]) => (
              <div key={k} className='muted confirm-value'>
                {FIELD_LABELS[k] ?? k}:{' '}
                {k === 'amount'
                  ? `${formatMoney(Number(row[k]), String(row.currency))} → ${formatMoney(Number(v), String(patch.currency ?? row.currency))}`
                  : `${fmt(k, row[k])} → ${v === null ? '(xóa)' : fmt(k, v)}`}
              </div>
            ))}
          </div>
        ))}

      <Thumbs ids={shown.attachment_ids as string[] | undefined} />
      {error && <Alert type='error' content={error} />}
      {pending && (
        <Space>
          <Button
            type='primary'
            status={action.tool_name.startsWith('delete_') ? 'danger' : undefined}
            loading={busy === 'confirm'}
            disabled={busy === 'cancel'}
            onClick={() => void resolve('confirm')}
          >
            Xác nhận
          </Button>
          <Button loading={busy === 'cancel'} disabled={busy === 'confirm'} onClick={() => void resolve('cancel')}>
            Hủy
          </Button>
        </Space>
      )}
    </div>
  );
}
