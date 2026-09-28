import { TOOLS, toOpenAITools } from '../src/main/tools';
import { z } from 'zod/v4';
import { date, instant, toInstant } from '../src/main/tools/common';

describe('tool registry', () => {
  it('has unique, API-safe names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z_]{1,64}$/);
  });

  it('exports object JSON schemas without $schema', () => {
    for (const t of toOpenAITools()) {
      expect(t.function.parameters).toMatchObject({ type: 'object' });
      expect(t.function.parameters).not.toHaveProperty('$schema');
      expect(t.function.description?.length).toBeGreaterThan(10);
    }
  });
});

describe('date schema', () => {
  it('rejects impossible calendar dates and wrong formats', () => {
    expect(date.safeParse('2026-02-30').success).toBe(false);
    expect(date.safeParse('2026-02-28').success).toBe(true);
    expect(date.safeParse('28/09/2026').success).toBe(false);
  });
});

describe('instant schema', () => {
  it('accepts dates and ISO datetimes, rejects loose strings', () => {
    for (const s of ['2026-09-29', '2026-09-29T09:00', '2026-09-29T09:00:00Z', '2026-09-29T09:00+07:00']) {
      expect(instant.safeParse(s).success).toBe(true);
    }
    for (const s of ['9', 'abc 2026', '2026-02-30T09:00']) expect(instant.safeParse(s).success).toBe(false);
    expect(z.prettifyError(instant.safeParse('9').error!)).toContain('Cần ngày YYYY-MM-DD hoặc thời điểm ISO 8601');
  });

  it('exports as JSON Schema', () => {
    expect(() => z.toJSONSchema(z.object({ at: instant }), { io: 'input' })).not.toThrow();
  });
});

describe('toInstant', () => {
  it('maps a bare date to local midnight and a local time to UTC', () => {
    expect(toInstant('2026-09-28')).toBe(new Date(2026, 8, 28).toISOString());
    expect(toInstant('2026-09-28', 'end')).toBe(new Date(2026, 8, 29).toISOString());
    expect(toInstant('2026-09-28T15:00')).toBe(new Date(2026, 8, 28, 15, 0).toISOString());
  });
});
