import { Alert, Button, Input, InputNumber, Select, Space, Tag } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLocalDate, RECURRENCE_RE, recurrenceText } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import type { PendingAction } from '../../shared/types';
import { useUiSettings } from '../api';
import { Thumbs } from '../components/Thumbs';

const SELECTS = new Set(['kind', 'priority']);
/** Single-line string fields; the others get an auto-growing textarea. */
const SHORT = new Set(['title', 'due_date', 'due_time', 'remind_at', 'spent_at', 'currency', 'category']);

const STATUS_COLORS = { pending: 'arcoblue', confirmed: 'green', cancelled: 'gray' } as const;

type Row = Record<string, unknown> & { id: number };

const cut = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function ConfirmCard(props: {
  action: PendingAction;
  args: Record<string, unknown>;
  onArgsChange: (args: Record<string, unknown>) => void;
  onResolve: (decision: 'confirm' | 'cancel') => Promise<void>;
}) {
  const { action, args, onArgsChange, onResolve } = props;
  const { t } = useTranslation(['chat', 'common']);
  const { moneyStyle, defaultCurrency } = useUiSettings();
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const money = (amount: unknown, currency: unknown) => formatMoney(Number(amount), String(currency), moneyStyle);
  const fieldLabel = (k: string) => (t('field', { returnObjects: true }) as Record<string, string>)[k] ?? k;
  /** Display names of enum values; `kind` and `priority` are picked from these on the create card. */
  const valueLabels = (k: string): Record<string, string> | undefined =>
    k === 'category' ? t('common:category', { returnObjects: true }) : (t('value', { returnObjects: true }) as Record<string, Record<string, string>>)[k];
  const fmt = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    if (k === 'recurrence') return recurrenceText(s, t);
    const label = valueLabels(k)?.[s];
    if (label) return label;
    // Stored instants are UTC ISO; LLM-given ones are local 'YYYY-MM-DDTHH:MM'. Both parse correctly.
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseLocalDate(s).toLocaleDateString('vi-VN');
    return s;
  };
  const describe = (r: Row): string => {
    if (r.amount != null) return `${cut(String(r.description || r.category))} · ${money(r.amount, r.currency)}`;
    if (r.remind_at) return `${cut(String(r.message))} · ${fmt('remind_at', r.remind_at)}`;
    return cut(String(r.title || r.body || ''));
  };
  const pending = action.status === 'pending';
  const shown = pending ? args : action.args; // after resolution, what was actually stored
  const isCreate = action.tool_name.startsWith('create_');
  const before = (action.preview as { before?: Row[] } | null)?.before ?? [];
  const patch = (shown.patch ?? {}) as Record<string, unknown>;
  const error = (action.result as { error?: string } | null)?.error;
  const status = error ? { color: 'red', text: t('state.failed') } : { color: STATUS_COLORS[action.status], text: t(`state.${action.status}`) };
  const currency = String(shown.currency ?? defaultCurrency); // create_expense applies the same default

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
      const options = Object.entries(valueLabels(k) ?? {}).map(([value, text]) => ({
        label: text,
        value: typeof action.args[k] === 'number' ? Number(value) : value,
      }));
      return <Select aria-label={label} value={v as string | number | undefined} options={options} onChange={set} />;
    }
    if (typeof action.args[k] === 'number') {
      return (
        <Space>
          <InputNumber aria-label={label} value={v as number | undefined} onChange={set} />
          {k === 'amount' && typeof v === 'number' && <span className='muted'>{money(v, currency)}</span>}
        </Space>
      );
    }
    if (k === 'recurrence') {
      return (
        <Space>
          <Input aria-label={label} value={String(v ?? '')} onChange={set} />
          {RECURRENCE_RE.test(String(v)) && <span className='muted'>{recurrenceText(String(v), t)}</span>}
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
        {(t('action', { returnObjects: true }) as Record<string, string>)[action.tool_name] ?? action.tool_name}
        <Tag color={status.color}>{status.text}</Tag>
      </div>

      {isCreate &&
        Object.entries(shown)
          .filter(([k]) => k !== 'attachment_ids')
          .map(([k, v]) => {
            const label = fieldLabel(k);
            return (
              <div key={k} className='confirm-row'>
                <span className='muted'>{label}</span>
                {pending ? (
                  editor(k, v, label)
                ) : (
                  <span className='confirm-value'>{k === 'amount' ? money(v, currency) : fmt(k, v)}</span>
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
                {fieldLabel(k)}:{' '}
                {k === 'amount'
                  ? `${money(row[k], row.currency)} → ${money(v, patch.currency ?? row.currency)}`
                  : `${fmt(k, row[k])} → ${v === null ? t('cleared') : fmt(k, v)}`}
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
            {t('confirm')}
          </Button>
          <Button loading={busy === 'cancel'} disabled={busy === 'confirm'} onClick={() => void resolve('cancel')}>
            {t('cancel')}
          </Button>
        </Space>
      )}
    </div>
  );
}
