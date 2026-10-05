import { CalendarDays, List, Plus, Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, parseLocalDate, toLocalDate, toLocalTime } from '../../shared/dates';
import type { ReminderRow } from '../../shared/types';
import { api } from '../api';
import { Btn, Chip, dayTitle, EmptyState, GroupLabel, ICON, PageBody, PageHeader, RowActions, Segmented } from '../components/ui';
import { Skeleton, useData } from '../useData';
import { ReminderForm } from './ReminderForm';

const STATUSES = ['pending', 'fired', 'dismissed'] as const;
const HISTORY_DAYS = 90;
const HOUR = 64; // px per hour in the week grid, as in the design
const EVENT_H = 40;

type View = 'week' | 'list';

/** Week of the next seven days (the design's default) or the list by day, with the status filter and history. */
export function RemindersPage() {
  const { t, i18n } = useTranslation(['pages', 'common', 'shell']);
  const lang = i18n.language === 'en' ? 'en-GB' : 'vi-VN';
  const [view, setView] = useState<View>('week');
  const [status, setStatus] = useState('pending');
  const [editing, setEditing] = useState<ReminderRow | null>(); // undefined: closed, null: adding
  const today = toLocalDate();
  // ponytail: list_reminders returns at most 200, oldest first. The list's pending view lists everything; its other views
  // only the last HISTORY_DAYS, newest first, so old history can't crowd out recent rows. The week reads its seven days.
  const read = useCallback(
    () =>
      view === 'week'
        ? api.data.read<ReminderRow[]>('list_reminders', { status: 'all', from: today, to: addDays(today, 6) })
        : status === 'pending'
          ? api.data.read<ReminderRow[]>('list_reminders', { status })
          : api.data.read<ReminderRow[]>('list_reminders', { status, from: addDays(today, -HISTORY_DAYS) }).then((rows) => rows.reverse()),
    [view, status, today]
  );
  const { data: reminders, loading, busy, write, remove, holders } = useData(read, []);

  const addButton = (
    <Btn variant='primary' icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
      {t('addReminder')}
    </Btn>
  );

  return (
    <div className='flex-1 min-w-0 flex flex-col min-h-0'>
      {holders}
      <div className='px-8 pt-6 pb-4'>
        <PageHeader
          title={t('common:nav.reminders')}
          meta={
            view === 'week'
              ? `${t('next7')} · ${new Date(parseLocalDate(today)).toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – ${parseLocalDate(addDays(today, 6)).toLocaleDateString(lang, { day: 'numeric', month: 'short' })}`
              : undefined
          }
        >
          <Segmented
            label={t('viewLabel')}
            value={view}
            onChange={setView}
            options={[
              { value: 'week', label: t('weekView'), icon: <CalendarDays {...ICON} /> },
              { value: 'list', label: t('listView'), icon: <List {...ICON} /> },
            ]}
          />
          {addButton}
        </PageHeader>
        {view === 'list' && (
          <Segmented
            className='mt-4'
            label={t('statusLabel')}
            value={status}
            onChange={setStatus}
            options={[...STATUSES.map((s) => ({ value: s as string, label: t(`reminderStatus.${s}`) })), { value: 'all', label: t('all') }]}
          />
        )}
      </div>

      {loading && (
        <div className='px-8'>
          <Skeleton />
        </div>
      )}
      {view === 'week' && !loading && <Week reminders={reminders} today={today} lang={lang} onEdit={setEditing} />}
      {view === 'list' && !loading && (
        <List_ reminders={reminders} status={status} busy={busy} write={write} remove={remove} onEdit={setEditing} empty={addButton} />
      )}
      {editing !== undefined && <ReminderForm reminder={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function Week({ reminders, today, lang, onEdit }: { reminders: ReminderRow[]; today: string; lang: string; onEdit: (r: ReminderRow) => void }) {
  const { t } = useTranslation(['pages']);
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const minutes = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() + d.getMinutes() / 60;
  };
  // 06:00 to 22:00 unless a reminder falls outside it.
  const first = Math.min(6, ...reminders.map((r) => Math.floor(minutes(r.remind_at))));
  const last = Math.max(22, ...reminders.map((r) => Math.floor(minutes(r.remind_at)) + 1));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const nowTop = (now.getHours() + now.getMinutes() / 60 - first) * HOUR;

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, nowTop - HOUR * 2);
  }, []); // once, to what is happening now

  return (
    <div className='flex-1 min-h-0 flex flex-col mx-5 mb-5 border border-solid border-line rounded-card overflow-hidden'>
      <div className='grid [grid-template-columns:56px_repeat(7,minmax(0,1fr))] border-b border-b-solid border-line'>
        <span />
        {days.map((d) => {
          const isToday = d === today;
          const date = parseLocalDate(d);
          return (
            <div key={d} className='flex items-center justify-center gap-1.5 px-1 py-2.5 border-l border-l-solid border-line' style={{ background: isToday ? 'var(--today-col)' : undefined }}>
              <span className='text-xs font-500 text-ink-2'>{date.toLocaleDateString(lang, { weekday: 'short' })}</span>
              <span className={`grid place-items-center min-w-6 h-6 px-1 rounded-full text-[12.5px] font-600 ${isToday ? 'bg-accent text-accent-on' : ''}`}>{date.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className='flex-1 min-h-0 overflow-y-auto'>
        <div className='relative grid [grid-template-columns:56px_repeat(7,minmax(0,1fr))]' style={{ height: (last - first + 1) * HOUR }}>
          <div className='relative'>
            {hours.map((h) => (
              <span key={h} className='absolute right-2 font-mono text-[10.5px] font-500 text-ink-3' style={{ top: (h - first) * HOUR, transform: 'translateY(-6px)' }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className='relative border-l border-l-solid border-line' style={{ background: d === today ? 'var(--today-col)' : undefined }}>
              {hours.map((h) => (
                <span key={h} className='absolute left-0 right-0 border-t border-t-solid border-line opacity-60' style={{ top: (h - first) * HOUR }} />
              ))}
              {reminders
                .filter((r) => toLocalDate(new Date(r.remind_at)) === d)
                .map((r) => {
                  const past = r.status !== 'pending' || new Date(r.remind_at).getTime() < now.getTime();
                  return (
                    <button
                      key={r.id}
                      type='button'
                      title={r.message}
                      onClick={() => onEdit(r)}
                      className={`absolute left-1 right-1 flex flex-col justify-center px-2 border-0 border-l-[3px] border-l-solid rounded-md text-left cursor-pointer ${past ? 'border-l-ink-3 bg-pill text-ink-3' : 'border-l-accent bg-accent-soft text-ink'}`}
                      style={{ top: (minutes(r.remind_at) - first) * HOUR, height: EVENT_H }}
                    >
                      <span className={`font-mono text-[10.5px] font-500 ${past ? '' : 'text-accent'}`}>{toLocalTime(new Date(r.remind_at))}</span>
                      <span className='text-xs font-500 truncate'>{r.message}</span>
                    </button>
                  );
                })}
            </div>
          ))}
          {nowTop >= 0 && (
            <div className='absolute pointer-events-none flex items-center' style={{ left: 56, right: 0, top: nowTop }}>
              <span className='w-2 h-2 -ml-1 rounded-full bg-danger' />
              <span className='flex-1 h-[1.5px] bg-danger' />
            </div>
          )}
        </div>
      </div>
      {!reminders.length && <span className='sr-only'>{t('noReminders')}</span>}
    </div>
  );
}

function List_({
  reminders,
  status,
  busy,
  write,
  remove,
  onEdit,
  empty,
}: {
  reminders: ReminderRow[];
  status: string;
  busy: number[];
  write: (id: number, tool: string, args: object) => Promise<void>;
  remove: (id: number, tool: string, what: string) => void;
  onEdit: (r: ReminderRow) => void;
  empty: React.ReactNode;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const groups = new Map<string, ReminderRow[]>(); // local date -> rows, in list order
  for (const r of reminders) {
    const day = toLocalDate(new Date(r.remind_at));
    groups.set(day, [...(groups.get(day) ?? []), r]);
  }
  return (
    <PageBody max={820} top={4}>
      {!reminders.length && (
        <EmptyState icon={<Bell {...ICON} />} title={t('noReminders')} hint={t('noRemindersHint')}>
          {empty}
        </EmptyState>
      )}
      {[...groups].map(([day, list]) => (
        <section key={day} className='flex flex-col gap-1.5'>
          <GroupLabel count={list.length}>{dayTitle(day, t)}</GroupLabel>
          <div className='border border-solid border-line rounded-card overflow-hidden'>
            {list.map((r) => {
              const isBusy = busy.includes(r.id);
              const pending = r.status === 'pending';
              return (
                <div key={r.id} className={`list-row ${pending ? '' : 'is-closed'}`}>
                  <span className='font-mono text-xs font-500 px-2 py-[3px] rounded-md bg-accent-soft text-accent'>{toLocalTime(new Date(r.remind_at))}</span>
                  <button type='button' className='row-main link text-[13.5px] font-400 truncate' disabled={isBusy} onClick={() => onEdit(r)}>
                    {r.message}
                  </button>
                  {status === 'all' && <Chip>{t(`reminderStatus.${r.status}`)}</Chip>}
                  {pending && (
                    <Btn size='sm' disabled={isBusy} onClick={() => void write(r.id, 'update_reminders', { ids: [r.id], patch: { status: 'dismissed' } })}>
                      {t('dismiss')}
                    </Btn>
                  )}
                  <RowActions editLabel={t('editReminderLabel', { what: r.message })} deleteLabel={t('deleteReminder', { what: r.message })} disabled={isBusy} onEdit={() => onEdit(r)} onDelete={() => remove(r.id, 'delete_reminders', r.message)} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </PageBody>
  );
}
