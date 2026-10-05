import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, validateJpeg } from '../src/server/server';
import { DEFAULT_LLM } from '../src/shared/types';
import { tempDir } from './helpers';

const TOKEN = 'test-token';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const b64 = (b: Buffer) => ({ $b64: b.toString('base64') });

let running: Awaited<ReturnType<typeof startServer>> | undefined;

async function boot() {
  const dataDir = tempDir();
  const rendererDir = tempDir();
  writeFileSync(join(rendererDir, 'index.html'), '<h1>app</h1>');
  running = await startServer({ dataDir, rendererDir, version: '9.9.9', port: 0, host: '127.0.0.1', env: { PA_TOKEN: TOKEN } });
  const base = `http://127.0.0.1:${running.port}`;
  const headers = { cookie: `pa_token=${TOKEN}`, 'content-type': 'application/json' };
  const call = async (channel: string, ...args: unknown[]) => {
    const res = await fetch(`${base}/rpc/${channel}`, { method: 'POST', headers, body: JSON.stringify({ args }) });
    return (await res.json()) as { ok: boolean; value?: any; error?: string };
  };
  return { dataDir, base, headers, call };
}

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('validateJpeg', () => {
  it('accepts JPEG bytes and rejects anything else', () => {
    expect(validateJpeg(new Uint8Array(JPEG)).equals(JPEG)).toBe(true);
    expect(() => validateJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(); // PNG
    expect(() => validateJpeg(new Uint8Array([0xff, 0xd8]))).toThrow(); // too short
    expect(() => validateJpeg('not bytes')).toThrow();
  });
});

describe('server over HTTP', () => {
  it('serves the app after the token redirect and creates/lists conversations', async () => {
    const { base, call } = await boot();
    const entry = await fetch(`${base}/?token=${TOKEN}`, { redirect: 'manual' });
    expect(entry.status).toBe(302);
    expect(entry.headers.get('set-cookie')).toContain('pa_token=');

    const created = await call('conv:create');
    expect(created.ok).toBe(true);
    const list = await call('conv:list');
    expect(list.value.map((c: { id: number }) => c.id)).toContain(created.value);
  });

  it('refuses file search: chat:send with files:true', async () => {
    const { call } = await boot();
    const conv = (await call('conv:create')).value;
    const r = await call('chat:send', conv, 'find my files', [], true);
    expect(r.ok).toBe(false);
    expect((await call('chat:messages', conv)).value).toEqual([]); // nothing was saved
  });

  it('data:save stores a JPEG, serves it on /att, and rejects a non-JPEG', async () => {
    const { base, headers, call } = await boot();
    const bad = await call('data:save', 'create_task', { title: 'x' }, [{ name: 'a.png', bytes: b64(Buffer.from([0x89, 0x50, 0x4e, 0x47])) }]);
    expect(bad.ok).toBe(false);
    expect((await call('data:read', 'list_tasks', {})).value).toHaveLength(0);

    const saved = await call('data:save', 'create_task', { title: 'Mua sữa' }, [{ name: 'a.jpg', bytes: b64(JPEG) }]);
    expect(saved.ok).toBe(true);
    const [id] = String(saved.value.attachment_ids).split(',');
    const img = await fetch(`${base}/att/${id}`, { headers });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
    expect((await fetch(`${base}/att/${id}`)).status).toBe(401); // no cookie
  });

  it('broadcasts data:changed over SSE after a save', async () => {
    const { base, headers, call } = await boot();
    const res = await fetch(`${base}/events`, { headers });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await reader.read()).value)).toContain(': ok');
    await call('data:save', 'create_note', { body: 'hello' }, []);
    let seen = '';
    while (!seen.includes('data:changed')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
    await reader.cancel();
    expect(seen).toContain(`data: ${JSON.stringify({ channel: 'data:changed' })}`);
  });

  it('keeps the API key out of the settings view and encrypted at rest', async () => {
    const { dataDir, call } = await boot();
    const llm = { ...DEFAULT_LLM, active: 'gateway', gateway: { endpoint: 'https://gw.example.com', model: 'm' } };
    expect((await call('settings:save', { llm, apiKey: 'sk-very-secret-value' })).ok).toBe(true);
    const view = await call('settings:get');
    expect(view.value.hasKey.gateway).toBe(true);
    expect(view.value.version).toBe('9.9.9');
    expect(JSON.stringify(view.value)).not.toContain('sk-very-secret-value');
    expect(existsSync(join(dataDir, 'secrets.key'))).toBe(true);
    expect(readFileSync(join(dataDir, 'secrets.bin')).includes('sk-very-secret-value')).toBe(false);
  });

  it('update:check cannot self-install in a container', async () => {
    const { call } = await boot();
    await call('settings:setUi', { checkUpdates: false }); // keep the test off the network
    const r = await call('update:check', false);
    expect(r.value).toMatchObject({ canInstall: false, manualInstall: false });
  });

  it('keeps the token across restarts of the same data dir', async () => {
    const dataDir = tempDir();
    const rendererDir = tempDir();
    const a = await startServer({ dataDir, rendererDir, version: 'x', port: 0, host: '127.0.0.1', env: {} });
    const token = a.token;
    await a.close();
    running = await startServer({ dataDir, rendererDir, version: 'x', port: 0, host: '127.0.0.1', env: {} });
    expect(running.token).toBe(token);
  });
});
