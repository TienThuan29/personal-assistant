import { createScheduler } from '../src/main/reminders';
import type { ReminderRow } from '../src/shared/types';
import { callTool, NOW, testCtx } from './helpers';

const HOUR = 3_600_000;

describe('reminder scheduler', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const ctx = testCtx(() => new Date());
    const fired: string[][] = [];
    const s = createScheduler({ db: ctx.db, now: () => new Date(), notify: (rows) => fired.push(rows.map((r) => r.message)) });
    return { ctx, fired, s };
  };

  it('fires each reminder once, on time', () => {
    const { ctx, fired, s } = setup();
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T09:01' });
    callTool(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-28T09:30' });
    s.refresh();
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual([['A']]);
    vi.advanceTimersByTime(29 * 60_000);
    expect(fired).toEqual([['A'], ['B']]);
    expect(callTool<ReminderRow[]>(ctx, 'list_reminders', { status: 'fired' })).toHaveLength(2);
    s.stop();
  });

  it('groups reminders missed while the app was off', () => {
    const { ctx, fired, s } = setup();
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T09:10' });
    callTool(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-28T09:20' });
    vi.setSystemTime(new Date(2026, 8, 28, 11, 0));
    s.refresh();
    expect(fired).toEqual([['A', 'B']]);
    s.stop();
  });

  it('re-arms at least hourly for far reminders', () => {
    const { ctx, fired, s } = setup();
    callTool(ctx, 'create_reminder', { message: 'Far', remind_at: '2026-09-28T13:00' });
    s.refresh();
    vi.advanceTimersByTime(3 * HOUR);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(HOUR);
    expect(fired).toEqual([['Far']]);
    s.stop();
  });

  it('a throwing notify neither re-fires nor stops the timer', () => {
    const ctx = testCtx(() => new Date());
    const fired: string[] = [];
    const s = createScheduler({
      db: ctx.db,
      now: () => new Date(),
      notify: (rows) => {
        fired.push(...rows.map((r) => r.message));
        throw new Error('notification failed');
      },
    });
    callTool(ctx, 'create_reminder', { message: 'A', remind_at: '2026-09-28T09:01' });
    callTool(ctx, 'create_reminder', { message: 'B', remind_at: '2026-09-28T09:30' });
    vi.setSystemTime(new Date(2026, 8, 28, 9, 5));
    expect(() => s.refresh()).toThrow('notification failed');
    expect(() => vi.advanceTimersByTime(25 * 60_000)).toThrow('notification failed');
    expect(fired).toEqual(['A', 'B']);
    s.stop();
  });
});
