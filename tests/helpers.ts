import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/main/db';
import { findTool, parseArgs, type ToolCtx } from '../src/main/tools';

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'pa-test-'));

/** A file-backed DB (so a read-only second connection can see it) plus that read-only connection. */
export function testDb() {
  const dir = tempDir();
  const path = join(dir, 'test.db');
  const db = openDb(path);
  const ro = new DatabaseSync(path, { readOnly: true });
  return { dir, path, db, ro };
}

/** 2026-09-28 09:00 local, a Monday. */
export const NOW = new Date(2026, 8, 28, 9, 0);

export function testCtx(now: () => Date = () => NOW): ToolCtx & { dir: string } {
  const { db, ro, dir } = testDb();
  return { db, ro, now, dir };
}

/** Parses args like the agent does, then runs (read) or applies (write) the tool. */
export function callTool<T = unknown>(ctx: ToolCtx, name: string, args: object): T {
  const tool = findTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const parsed = parseArgs(tool, args);
  return (tool.kind === 'read' ? tool.run(parsed, ctx) : tool.apply(parsed, ctx)) as T;
}
