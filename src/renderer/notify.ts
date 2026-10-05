import type { ReminderRow } from '../shared/types';

export type NotifyState = NotificationPermission | 'unsupported';

export const notifyState = (): NotifyState => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/** Browser counterpart of the main process's reminder toast (Docker mode). Silent unless the user allowed notifications. */
export function showReminders(rows: ReminderRow[], title: (count: number) => string, onClick: () => void): void {
  if (notifyState() !== 'granted') return;
  const n = new Notification(title(rows.length), {
    body: rows.map((r) => (rows.length === 1 ? r.message : `• ${r.message}`)).join('\n'),
  });
  n.onclick = () => {
    window.focus();
    onClick();
    n.close();
  };
}
