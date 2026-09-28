import type { ReminderRow } from '../shared/types';
import { type Db, tx } from './db';

const MAX_WAIT = 60 * 60 * 1000;

/**
 * Fires due reminders (several at once = one grouped notification) and sleeps until the next one,
 * at most an hour at a time so clock changes and sleep/resume can't make it miss.
 * Call refresh() after any reminder write and on powerMonitor 'resume'.
 * Due rows are marked fired and the next timer armed before notify runs, so a throwing notify
 * never re-fires them or stops the scheduler, and notify may call refresh() itself.
 */
export function createScheduler(opts: { db: Db; now: () => Date; notify: (due: ReminderRow[]) => void }) {
  const { db, now, notify } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh(): void {
    clearTimeout(timer);
    const due = tx(db, () => {
      const rows = db
        .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at")
        .all(now().toISOString()) as unknown as ReminderRow[];
      const mark = db.prepare("UPDATE reminders SET status = 'fired' WHERE id = ?");
      for (const r of rows) mark.run(r.id);
      return rows;
    });
    const { at } = db.prepare("SELECT MIN(remind_at) AS at FROM reminders WHERE status = 'pending'").get() as { at: string | null };
    if (at) timer = setTimeout(refresh, Math.min(Math.max(Date.parse(at) - now().getTime(), 0), MAX_WAIT));
    if (due.length) notify(due);
  }

  return { refresh, stop: () => clearTimeout(timer) };
}
