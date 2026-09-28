import { ftsQuery } from '../src/main/tools/notes';
import type { NoteRow } from '../src/shared/types';
import { callTool, testCtx } from './helpers';

describe('note tools', () => {
  it('finds accented text without diacritics, with highlighted snippet', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_note', { body: 'Họp với chị Lan về ngân sách quý 4' });
    const [hit] = callTool<NoteRow[]>(ctx, 'search_notes', { query: 'ngan sach' });
    expect(hit.snippet).toContain('**');
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'NGÂN SÁCH' })).toHaveLength(1);
  });

  it('matches title-only hits and đ as d', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_note', { title: 'Đi chợ', body: 'mua rau' });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'cho' })).toHaveLength(1);
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'di cho' })).toHaveLength(1);
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'ĐI' })).toHaveLength(1);
    callTool(ctx, 'create_note', { body: 'dự án' });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'đự' })).toHaveLength(1);
    expect(ftsQuery('Đi')).toBe('("di"* OR "đi"*)');
  });

  it('prefix-matches and survives punctuation-only queries', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_note', { body: 'Ý tưởng khởi nghiệp' });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'khởi' })).toHaveLength(1);
    expect(() => callTool(ctx, 'search_notes', { query: '" - *' })).not.toThrow();
    expect(ftsQuery('a"b c')).toBe('"a""b"* AND "c"*');
  });

  it('re-indexes on update and forgets on delete', () => {
    const ctx = testCtx();
    const n = callTool<NoteRow>(ctx, 'create_note', { body: 'táo' });
    callTool(ctx, 'update_notes', { ids: [n.id], patch: { body: 'chuối' } });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'tao' })).toHaveLength(0);
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'chuoi' })).toHaveLength(1);
    callTool(ctx, 'delete_notes', { ids: [n.id] });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { query: 'chuoi' })).toHaveLength(0);
  });

  it('filters by kind and returns full bodies via get_notes', () => {
    const ctx = testCtx();
    callTool(ctx, 'create_note', { body: 'ghi chú' });
    const j = callTool<NoteRow>(ctx, 'create_note', { kind: 'journal', body: 'Hôm nay trời đẹp' });
    expect(callTool<NoteRow[]>(ctx, 'search_notes', { kind: 'journal' }).map((n) => n.id)).toEqual([j.id]);
    expect(callTool<NoteRow[]>(ctx, 'get_notes', { ids: [j.id] })[0].body).toBe('Hôm nay trời đẹp');
  });
});
