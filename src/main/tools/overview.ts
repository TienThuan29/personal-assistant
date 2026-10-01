import { z } from 'zod/v4';
import { localDayRange, toLocalDate } from '../../shared/dates';
import { readTool } from './common';

export const overviewTools = [
  readTool({
    name: 'get_today_overview',
    description: "Today at a glance: tasks due today, overdue tasks (max 50, longest overdue first), today's reminders and today's total spending.",
    schema: z.object({}),
    run: (_a, { db, now }) => {
      const today = toLocalDate(now());
      const { start, end } = localDayRange(today);
      return {
        today,
        tasks_today: db
          .prepare("SELECT * FROM tasks WHERE status = 'todo' AND due_date = ? ORDER BY due_time IS NULL, due_time, priority")
          .all(today),
        overdue: db.prepare("SELECT * FROM tasks WHERE status = 'todo' AND due_date < ? ORDER BY due_date LIMIT 50").all(today),
        reminders_today: db
          .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at >= ? AND remind_at < ? ORDER BY remind_at")
          .all(start, end),
        spent_today: db.prepare('SELECT currency, SUM(amount) AS total FROM expenses WHERE spent_at = ? GROUP BY currency ORDER BY currency').all(today),
      };
    },
  }),
];
