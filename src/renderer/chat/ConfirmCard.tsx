import { Alert, Button, Input, InputNumber, Space, Tag } from '@arco-design/web-react';
import { useState } from 'react';
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

export const FIELD_LABELS: Record<string, string> = {
  title: 'Tiêu đề',
  notes: 'Ghi chú',
  category: 'Phân loại',
  priority: 'Ưu tiên (1–3)',
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

const STATUS = {
  pending: { color: 'arcoblue', text: 'Chờ xác nhận' },
  confirmed: { color: 'green', text: 'Đã thực hiện' },
  cancelled: { color: 'gray', text: 'Đã hủy' },
} as const;

type Row = Record<string, unknown> & { id: number };

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  // Stored instants are UTC ISO; LLM-given ones are local 'YYYY-MM-DDTHH:MM'. Both parse correctly.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('vi-VN');
  return String(v);
};
const describe = (r: Row): string =>
  r.amount != null
    ? `${String(r.description ?? r.category)} · ${formatMoney(Number(r.amount), String(r.currency))}`
    : String(r.title ?? r.message ?? String(r.body ?? '').slice(0, 60));

export function ConfirmCard(props: {
  action: PendingAction;
  args: Record<string, unknown>;
  onArgsChange: (args: Record<string, unknown>) => void;
  onResolve: (decision: 'confirm' | 'cancel') => Promise<void>;
}) {
  const { action, args, onArgsChange, onResolve } = props;
  const [busy, setBusy] = useState(false);
  const pending = action.status === 'pending';
  const isCreate = action.tool_name.startsWith('create_');
  const before = (action.preview as { before?: Row[] } | null)?.before ?? [];
  const patch = (args.patch ?? {}) as Record<string, unknown>;
  const error = (action.result as { error?: string } | null)?.error;
  const status = error ? { color: 'red', text: 'Thất bại' } : STATUS[action.status];

  const resolve = async (d: 'confirm' | 'cancel') => {
    setBusy(true);
    try {
      await onResolve(d);
    } finally {
      setBusy(false);
    }
  };

  // Only fields the LLM filled are shown; the user can edit them but not add new ones.
  // The editor follows the original arg type, so a cleared number stays a number field; cleared = omitted.
  return (
    <div className='confirm-card'>
      <div className='confirm-title'>
        {TITLES[action.tool_name] ?? action.tool_name}
        <Tag color={status.color}>{status.text}</Tag>
      </div>

      {isCreate &&
        Object.entries(args)
          .filter(([k]) => k !== 'attachment_ids')
          .map(([k, v]) => (
            <div key={k} className='confirm-row'>
              <span className='muted'>{FIELD_LABELS[k] ?? k}</span>
              {!pending ? (
                <span>{k === 'amount' ? formatMoney(Number(v), String(args.currency ?? 'VND')) : fmt(v)}</span>
              ) : typeof action.args[k] === 'number' ? (
                <Space>
                  <InputNumber value={v as number | undefined} onChange={(n) => onArgsChange({ ...args, [k]: n ?? undefined })} />
                  {k === 'amount' && typeof v === 'number' && (
                    <span className='muted'>{formatMoney(v, String(args.currency ?? 'VND'))}</span>
                  )}
                </Space>
              ) : (
                <Input value={String(v ?? '')} onChange={(s) => onArgsChange({ ...args, [k]: s || undefined })} />
              )}
            </div>
          ))}

      {!isCreate &&
        before.map((row) => (
          <div key={row.id}>
            <div>
              #{row.id} {describe(row)}
            </div>
            {Object.entries(patch).map(([k, v]) => (
              <div key={k} className='muted'>
                {FIELD_LABELS[k] ?? k}:{' '}
                {k === 'amount'
                  ? `${formatMoney(Number(row[k]), String(row.currency))} → ${formatMoney(Number(v), String(patch.currency ?? row.currency))}`
                  : `${fmt(row[k])} → ${fmt(v)}`}
              </div>
            ))}
          </div>
        ))}

      <Thumbs ids={args.attachment_ids as string[] | undefined} />
      {error && <Alert type='error' content={error} />}
      {pending && (
        <Space>
          <Button type='primary' loading={busy} onClick={() => void resolve('confirm')}>
            Xác nhận
          </Button>
          <Button disabled={busy} onClick={() => void resolve('cancel')}>
            Hủy
          </Button>
        </Space>
      )}
    </div>
  );
}
