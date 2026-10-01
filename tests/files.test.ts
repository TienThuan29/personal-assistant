import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../src/main/tools';
import { FILE_LIMITS, FILE_TOOLS, fileError, findFileTool, matcher, revealTarget } from '../src/main/tools/files';
import { errMsg } from '../src/main/errors';
import { tempDir } from './helpers';

/** A fake home: docs with Vietnamese names, noise folders, secrets, a binary, UTF-16 and a junction to a folder outside. */
function fakeHome() {
  const root = tempDir();
  const home = join(root, 'home');
  const put = (rel: string, data: string | Buffer) => {
    mkdirSync(join(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), data);
  };
  put('Documents/Báo cáo tháng 9.txt', 'Doanh thu tăng\nChi phí giảm\n');
  put('Documents/Work/plan.md', '# Kế hoạch\nNgân sách quý 4: 100 triệu\n');
  put('Documents/Work/deep/a/b/note.md', 'ngan sach\n');
  put('Documents/.hidden/x.txt', 'x');
  put('Documents/photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  put('Documents/utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Xin chào\nDòng hai', 'utf16le')]));
  put('Documents/.env', 'TOKEN=secret');
  put('Documents/server.pem', 'KEY');
  put('project/node_modules/lib/index.js', 'module');
  put('AppData/Roaming/app/secrets.txt', 'secret');
  put('.ssh/id_rsa', 'KEY');
  put('big.log', Array.from({ length: 30_000 }, (_, i) => `line ${i + 1} ${'x'.repeat(10)}`).join('\n'));
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside/leak.txt'), 'leak');
  symlinkSync(join(root, 'outside'), join(home, 'link'), 'junction');
  return { home, root };
}

const run = async (name: string, args: object, home: string) => {
  const tool = findFileTool(name)!;
  try {
    return (await tool.run(parseArgs(tool, args), { home })) as Record<string, unknown> & { results: { path: string }[] };
  } catch (e) {
    return { error: errMsg(fileError(e)) } as never;
  }
};
const paths = (r: { results: { path: string }[] }) => r.results.map((x) => x.path).sort();

describe('matcher', () => {
  it('matches plain text anywhere in the name, without case or accents', () => {
    const m = matcher('bao cao');
    expect(m('', 'Báo Cáo tháng 9.txt')).toBe(true);
    expect(m('', 'report.txt')).toBe(false);
    expect(matcher('đơn')('', 'Don hang.xlsx')).toBe(true);
  });

  it('treats * ? ** as a glob, also for dot names, and / patterns against the path', () => {
    expect(matcher('*.PDF')('', 'a.pdf')).toBe(true);
    expect(matcher('*')('', '.env')).toBe(true);
    expect(matcher('?.md')('', 'ab.md')).toBe(false);
    expect(matcher('Work/**/*.md')('Work/deep/a/note.md', 'note.md')).toBe(true);
    expect(matcher('Work/*.md')('Work/deep/a/note.md', 'note.md')).toBe(false);
    expect(matcher('constructor')('', 'constructor.js')).toBe(true); // no prototype lookups
    expect(matcher('a(b)+[c]')('', 'a(b)+[c]')).toBe(true); // regex characters are literal
  });
});

describe('find_files', () => {
  const { home } = fakeHome();

  it('finds by name across home, skipping noise, secrets, blocked folders and junctions', async () => {
    expect(paths(await run('find_files', { pattern: 'bao cao' }, home))).toEqual(['~/Documents/Báo cáo tháng 9.txt']);
    const all = paths(await run('find_files', { pattern: '*' }, home));
    expect(all).toContain('~/Documents/.hidden/x.txt');
    for (const hidden of ['node_modules', 'AppData', '.ssh', '.env', 'server.pem', 'link', 'leak']) expect(all.join('\n')).not.toContain(hidden);
  });

  it('filters by type and depth and returns size and date', async () => {
    const r = await run('find_files', { pattern: '*', under: '~/Documents', depth: 1, type: 'file' }, home);
    expect(paths(r)).toEqual(['~/Documents/Báo cáo tháng 9.txt', '~/Documents/photo.png', '~/Documents/utf16.txt']);
    expect(r.results[0]).toMatchObject({ type: 'file', size: expect.any(Number), modified: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/) });
    expect(paths(await run('find_files', { pattern: 'work', type: 'dir' }, home))).toEqual(['~/Documents/Work']);
  });

  it('stops at the result limit and says so', async () => {
    const many = tempDir();
    for (let i = 0; i <= FILE_LIMITS.results; i++) writeFileSync(join(many, `f${i}.txt`), '');
    const r = await run('find_files', { pattern: '*.txt' }, many);
    expect(r.results).toHaveLength(FILE_LIMITS.results);
    expect(r.truncated).toBe(true);
  });

  it('refuses folders outside home, blocked ones and a missing one', async () => {
    expect(await run('find_files', { pattern: '*', under: '..' }, home)).toEqual({ error: expect.stringMatching(/~|home/) });
    expect(await run('find_files', { pattern: '*', under: '~/link' }, home)).toEqual({ error: expect.stringMatching(/~|home/) });
    expect(await run('find_files', { pattern: '*', under: '~/AppData' }, home)).toEqual({ error: expect.stringMatching(/nhạy cảm|sensitive/) });
    expect(await run('find_files', { pattern: '*', under: '~/nope' }, home)).toEqual({ error: expect.stringMatching(/Không tìm thấy|not found/) });
  });
});

describe('grep_files', () => {
  const { home } = fakeHome();

  it('finds text without case or accents, with line numbers', async () => {
    const r = await run('grep_files', { query: 'ngân sách', under: '~/Documents' }, home);
    expect(r.results).toEqual([
      { path: '~/Documents/Work/plan.md', line: 2, text: 'Ngân sách quý 4: 100 triệu' },
      { path: '~/Documents/Work/deep/a/b/note.md', line: 1, text: 'ngan sach' },
    ]);
    expect((await run('grep_files', { query: 'ngan sach', under: 'Documents', glob: 'plan*' }, home)).results).toHaveLength(1);
  });

  it('skips binary and secret files, and refuses the whole home', async () => {
    expect((await run('grep_files', { query: 'secret', under: '~/Documents' }, home)).results).toEqual([]);
    expect(await run('grep_files', { query: 'x', under: '~' }, home)).toEqual({ error: expect.stringMatching(/find_files/) });
  });
});

describe('read_file', () => {
  const { home, root } = fakeHome();

  it('reads text of any extension, UTF-16 with a BOM, and only describes a binary', async () => {
    expect(await run('read_file', { path: '~/Documents/Work/plan.md' }, home)).toMatchObject({
      path: '~/Documents/Work/plan.md',
      content: '# Kế hoạch\nNgân sách quý 4: 100 triệu\n'.trimEnd(),
      from_line: 1,
      to_line: 2,
      more: false,
    });
    expect(await run('read_file', { path: 'Documents/utf16.txt' }, home)).toMatchObject({ content: 'Xin chào\nDòng hai' });
    const bin = await run('read_file', { path: '~/Documents/photo.png' }, home);
    expect(bin).toMatchObject({ binary: true, size: 8 });
    expect(bin).not.toHaveProperty('content');
  });

  it('pages a long file by lines', async () => {
    const first = await run('read_file', { path: '~/big.log' }, home);
    expect(first).toMatchObject({ from_line: 1, more: true });
    expect((first.content as string).length).toBeLessThanOrEqual(FILE_LIMITS.readChars);
    const next = await run('read_file', { path: '~/big.log', from_line: (first.to_line as number) + 1 }, home);
    expect((next.content as string).startsWith(`line ${(first.to_line as number) + 1} `)).toBe(true);
  });

  it('refuses secrets, paths out of home (also through a junction) and folders', async () => {
    for (const path of ['~/.ssh/id_rsa', '~/Documents/.env', '~/AppData/Roaming/app/secrets.txt'])
      expect(await run('read_file', { path }, home)).toEqual({ error: expect.stringMatching(/nhạy cảm|sensitive/) });
    for (const path of ['~/link/leak.txt', '../outside/leak.txt', join(root, 'outside/leak.txt')])
      expect(await run('read_file', { path }, home)).toEqual({ error: expect.stringMatching(/~|home/) });
    expect(await run('read_file', { path: '~/Documents' }, home)).toEqual({ error: expect.stringMatching(/find_files/) });
  });
});

describe('revealTarget', () => {
  const { home, root } = fakeHome();

  it('gives the real path of a ~/… reference, under the same rules as the tools', async () => {
    expect(await revealTarget(home, '~/Documents/Work/plan.md')).toBe(realpathSync.native(join(home, 'Documents/Work/plan.md')));
    await expect(revealTarget(home, '~/.ssh/id_rsa')).rejects.toThrow(/nhạy cảm|sensitive/);
    await expect(revealTarget(home, '~/link/leak.txt')).rejects.toThrow(/~|home/);
    await expect(revealTarget(home, '~/gone.txt')).rejects.toThrow(/Không tìm thấy|not found/);
  });

  it('accepts either spelling of a symlinked home (macOS /var vs /private/var)', async () => {
    const alias = join(root, 'alias');
    symlinkSync(home, alias, 'junction');
    expect(await revealTarget(alias, join(home, 'Documents/Work/plan.md'))).toBe(realpathSync.native(join(home, 'Documents/Work/plan.md')));
    expect(await revealTarget(alias, join(alias, 'Documents/Work/plan.md'))).toBe(realpathSync.native(join(home, 'Documents/Work/plan.md')));
  });
});

it('the file tools are not in the database tool registry, so data:read cannot reach them', async () => {
  const { findTool } = await import('../src/main/tools');
  for (const t of FILE_TOOLS) expect(findTool(t.name)).toBeUndefined();
});
