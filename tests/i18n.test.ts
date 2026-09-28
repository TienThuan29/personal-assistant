import { setLanguage } from '../src/main/i18n';
import { findTool, parseArgs } from '../src/main/tools';
import { resources } from '../src/shared/i18n';
import { callTool, testCtx } from './helpers';

type Tree = { [k: string]: string | Tree };

/** key path → sorted {{placeholders}} */
function flatten(t: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, [...v.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(','));
    else for (const [k2, v2] of flatten(v, key)) out.set(k2, v2);
  }
  return out;
}

describe('i18n resources', () => {
  it('vi and en have the same keys and placeholders', () => {
    const vi = flatten(resources.vi as unknown as Tree);
    const en = flatten(resources.en as unknown as Tree);
    expect([...en.keys()].sort()).toEqual([...vi.keys()].sort());
    for (const [k, p] of vi) expect(en.get(k), k).toBe(p);
  });
});

describe('main language', () => {
  afterEach(() => setLanguage('vi'));

  it('translates tool and zod errors into the current language', () => {
    const ctx = testCtx();
    const past = { message: 'x', remind_at: '2026-09-28T08:00' };
    expect(() => callTool(ctx, 'create_reminder', past)).toThrow('Thời điểm nhắc đã qua');
    setLanguage('en');
    expect(() => callTool(ctx, 'create_reminder', past)).toThrow('The reminder time has already passed');
    expect(() => parseArgs(findTool('list_tasks')!, { from: '28/09/2026' })).toThrow(/Use the format YYYY-MM-DD[\s\S]*from/);
  });
});
