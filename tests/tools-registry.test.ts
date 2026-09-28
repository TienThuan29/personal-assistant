import { TOOLS, toOpenAITools } from '../src/main/tools';
import { date } from '../src/main/tools/common';

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
