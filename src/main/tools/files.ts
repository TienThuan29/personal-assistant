import { createReadStream } from 'node:fs';
import { open, opendir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod/v4';
import { toLocalDate, toLocalTime } from '../../shared/dates';
import { fold } from '../db';
import { type FsCtx, fsTool, type Tool, UserError } from './common';

type FsTool = Extract<Tool, { kind: 'fs' }>;

// Read-only search and reading of the user's files under their home folder (docs/file-search-design.md).
// Nothing here writes, renames, opens or runs a file.

export const FILE_LIMITS = { results: 200, ms: 10_000, grepBytes: 1 << 20, readChars: 100_000, lineChars: 200 };

/** Home-level folders holding keys, tokens and app data (this app's own included): never listed or read. */
const BLOCKED_TOP = new Set(['appdata', 'library', '.config', '.local', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.password-store']);
/** Secret files, anywhere. */
const BLOCKED_FILE = /^(\.env.*|.*\.(pem|key|pfx|p12|kdbx)|id_(rsa|ed25519|ecdsa|dsa).*|\.npmrc|\.netrc|\.git-credentials|\.pypirc)$/i;
/** Heavy noise skipped while walking; a file inside is still readable by its exact path. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '$recycle.bin', '.trash', '__pycache__', '.venv']);

/** `rel` is relative to the real home folder. */
const blocked = (rel: string): boolean => {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 && (BLOCKED_TOP.has(parts[0].toLowerCase()) || BLOCKED_FILE.test(parts.at(-1)!));
};
const outside = (rel: string): boolean => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
const posix = (rel: string): string => rel.split(sep).join('/');
const shown = (rel: string): string => (rel ? `~/${posix(rel)}` : '~');
const when = (d: Date): string => `${toLocalDate(d)} ${toLocalTime(d)}`;

/** Node's errors as messages the model (and the user) can act on. */
export function fileError(e: unknown): unknown {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new UserError('fileNotFound');
  if (code === 'EACCES' || code === 'EPERM') return new UserError('fileDenied');
  if (code === 'EBUSY') return new UserError('fileLocked');
  return e;
}

type Place = { abs: string; rel: string; home: string };

/** A path the model gave (~/…, relative to ~, or absolute) as a real path inside home that is not blocked; symlinks can't lead out. */
async function locate(ctx: FsCtx, p: string): Promise<Place> {
  const home = await realpath(ctx.home);
  const lexical = resolve(ctx.home, p.trim().replace(/^~(?=$|[\\/])/, ctx.home));
  let abs: string;
  try {
    abs = await realpath(lexical); // the real path decides: home may have several spellings (macOS /var vs /private/var, Windows 8.3 names)
  } catch (e) {
    // A missing path outside home reads as "outside", not "not found", so nothing outside home can be probed.
    if (outside(relative(ctx.home, lexical)) && outside(relative(home, lexical))) throw new UserError('fileOutside');
    throw e;
  }
  const rel = relative(home, abs);
  if (outside(rel)) throw new UserError('fileOutside');
  if (blocked(rel)) throw new UserError('fileBlocked');
  return { abs, rel, home };
}

async function locateDir(ctx: FsCtx, p: string): Promise<Place> {
  const place = await locate(ctx, p);
  if (!(await stat(place.abs)).isDirectory()) throw new UserError('notAFolder');
  return place;
}

/**
 * Glob (`*`, `?`, `**`) or plain text matched anywhere in the name; case- and accent-insensitive.
 * A pattern with `/` is matched against the path relative to the search folder, otherwise against the name.
 */
export function matcher(pattern: string): (rel: string, name: string) => boolean {
  const p = fold(pattern.trim().replace(/\\/g, '/').replace(/^~?\//, ''));
  const onPath = p.includes('/');
  const glob = /[*?]/.test(p) ? p : onPath ? `**/*${p}*` : `*${p}*`;
  const token = new Map([['**/', '(?:.*/)?'], ['**', '.*'], ['*', '[^/]*'], ['?', '[^/]']]);
  const source = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((t) => token.get(t) ?? t.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('');
  const re = new RegExp(`^${source}$`, 's');
  return (rel, name) => re.test(fold(onPath ? posix(rel) : name));
}

type Entry = { abs: string; rel: string; name: string; dir: boolean };
type Walk = { truncated: boolean; skipped: number; deadline: number };

/** Breadth-first (nearer first) below `root`, never following symlinks or junctions; skips noise and blocked paths, stops at the deadline or on abort. */
async function* walk(root: Place, maxDepth: number, state: Walk, signal?: AbortSignal): AsyncGenerator<Entry> {
  const queue: [string, number][] = [[root.abs, 1]];
  for (let i = 0; i < queue.length; i++) {
    const [dir, depth] = queue[i];
    try {
      for await (const d of await opendir(dir)) {
        if (signal?.aborted || Date.now() > state.deadline) {
          state.truncated = true;
          return;
        }
        if (d.isSymbolicLink()) continue;
        const abs = join(dir, d.name);
        const rel = relative(root.home, abs);
        const isDir = d.isDirectory();
        if (blocked(rel) || (isDir && SKIP_DIRS.has(d.name.toLowerCase()))) continue;
        yield { abs, rel, name: d.name, dir: isDir };
        if (isDir && depth < maxDepth) queue.push([abs, depth + 1]);
      }
    } catch {
      state.skipped++; // no permission, or the folder vanished
    }
  }
}

/** Text of a file's bytes, or null when it looks binary. UTF-16LE needs its BOM; a NUL byte in the first 8 KB means binary. */
const decode = (buf: Buffer): string | null => {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString('utf8').replace(/^﻿/, '');
};

async function head(abs: string): Promise<Buffer> {
  const fh = await open(abs, 'r');
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(8192), 0, 8192, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const newWalk = (): Walk => ({ truncated: false, skipped: 0, deadline: Date.now() + FILE_LIMITS.ms });
const flags = (w: Walk) => ({ ...(w.truncated ? { truncated: true } : {}), ...(w.skipped ? { skipped_folders: w.skipped } : {}) });
const under = z.string().min(1).max(500);

export const FILE_TOOLS: FsTool[] = [
  fsTool({
    name: 'find_files',
    description:
      'Find files and folders under the user\'s home folder (~) by name. Read-only. pattern: a glob (* ? **) or plain text found anywhere in the name, case- and accent-insensitive ("bao cao" finds "Báo cáo T9.docx"); a pattern containing / is matched against the path relative to `under`. depth 1 with pattern "*" lists one folder. At most 200 results, nearest first; truncated: true means there may be more, so narrow `under` or the pattern.',
    schema: z.object({
      pattern: z.string().min(1).max(200),
      under: under.default('~').describe('Folder to search in, e.g. ~/Documents'),
      type: z.enum(['any', 'file', 'dir']).default('any'),
      depth: z.number().int().min(1).max(50).optional().describe('How many folder levels deep; omit for no limit'),
    }),
    async run({ pattern, under, type, depth }, ctx) {
      const root = await locateDir(ctx, under);
      const match = matcher(pattern);
      const w = newWalk();
      const found: Entry[] = [];
      for await (const e of walk(root, depth ?? Infinity, w, ctx.signal)) {
        if ((type === 'file' && e.dir) || (type === 'dir' && !e.dir) || !match(relative(root.abs, e.abs), e.name)) continue;
        if (found.length === FILE_LIMITS.results) {
          w.truncated = true;
          break;
        }
        found.push(e);
      }
      const results = await Promise.all(
        found.map(async (e) => {
          const s = await stat(e.abs).catch(() => null);
          return { path: shown(e.rel), type: e.dir ? 'dir' : 'file', ...(s && !e.dir ? { size: s.size } : {}), ...(s ? { modified: when(s.mtime) } : {}) };
        })
      );
      return { results, ...flags(w) };
    },
  }),
  fsTool({
    name: 'grep_files',
    description:
      'Find text inside the files of one folder below ~ (not ~ itself: find the folder with find_files first). Read-only. Case- and accent-insensitive plain text, not a regex. Skips binary files and files over 1 MB. Returns up to 200 matching lines.',
    schema: z.object({
      query: z.string().min(1).max(200),
      under: under.describe('A folder below ~, e.g. ~/Documents/Work'),
      glob: z.string().min(1).max(200).optional().describe('Only files whose name matches, e.g. *.md'),
    }),
    async run({ query, under, glob }, ctx) {
      const root = await locateDir(ctx, under);
      if (!root.rel) throw new UserError('grepHome');
      const want = fold(query);
      const match = glob ? matcher(glob) : null;
      const w = newWalk();
      const results: { path: string; line: number; text: string }[] = [];
      for await (const e of walk(root, Infinity, w, ctx.signal)) {
        if (e.dir || (match && !match(relative(root.abs, e.abs), e.name))) continue;
        const text = await stat(e.abs)
          .then(async (s) => (s.size <= FILE_LIMITS.grepBytes ? decode(await readFile(e.abs)) : null))
          .catch(() => null);
        if (!text) continue;
        for (const [i, line] of text.split(/\r?\n/).entries()) {
          if (!fold(line).includes(want)) continue;
          if (results.length === FILE_LIMITS.results) {
            w.truncated = true;
            break;
          }
          results.push({ path: shown(e.rel), line: i + 1, text: line.trim().slice(0, FILE_LIMITS.lineChars) });
        }
        if (w.truncated) break;
      }
      return { results, ...flags(w) };
    },
  }),
  fsTool({
    name: 'read_file',
    description:
      "Read a text file under ~ (any extension). Read-only. Returns about 100 KB of lines from from_line; more: true means call again with from_line = to_line + 1. A binary file (PDF, Word, image…) returns only its size and date with binary: true.",
    schema: z.object({
      path: under.describe('File path, e.g. ~/Documents/notes.txt'),
      from_line: z.number().int().min(1).default(1),
    }),
    async run({ path, from_line }, ctx) {
      const f = await locate(ctx, path);
      const s = await stat(f.abs);
      if (s.isDirectory()) throw new UserError('fileIsFolder');
      const info = { path: shown(f.rel), size: s.size, modified: when(s.mtime) };
      const start = await head(f.abs);
      const utf16 = start[0] === 0xff && start[1] === 0xfe;
      if (!utf16 && start.includes(0)) return { ...info, binary: true };
      const input = createReadStream(f.abs, { encoding: utf16 ? 'utf16le' : 'utf8', start: utf16 ? 2 : 0 });
      const lines: string[] = [];
      let n = 0;
      let size = 0;
      let more = false;
      try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
          if (++n < from_line) continue;
          if (lines.length && size + line.length > FILE_LIMITS.readChars) {
            more = true;
            break;
          }
          lines.push(line.slice(0, FILE_LIMITS.readChars)); // ponytail: one giant line (minified file) is cut, not paged
          size += line.length + 1;
        }
      } finally {
        input.destroy();
      }
      if (from_line === 1 && lines.length) lines[0] = lines[0].replace(/^﻿/, '');
      return { ...info, content: lines.join('\n'), from_line, to_line: from_line + lines.length - 1, more };
    },
  }),
];

export const findFileTool = (name: string): FsTool | undefined => FILE_TOOLS.find((t) => t.name === name);

/** The real path of a ~/… reference the user clicked, under the same rules as the tools (inside home, not blocked, existing). */
export const revealTarget = async (home: string, p: string): Promise<string> => {
  try {
    return (await locate({ home }, p)).abs;
  } catch (e) {
    throw fileError(e);
  }
};
