import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieHeader, hostOk, loadToken, originOk, readCookie } from '../src/server/auth';
import { createApp, type Handler } from '../src/server/http';
import { tempDir } from './helpers';

const TOKEN = 'test-token';
const COOKIE = `pa_token=${TOKEN}`;

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

function request(port: number, o: { method?: string; path: string; headers?: http.OutgoingHttpHeaders; body?: string }): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = http.request({ host: '127.0.0.1', port, method: o.method ?? 'GET', path: o.path, headers: { host: `localhost:${port}`, ...o.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end(o.body);
  });
}

const rpc = (port: number, channel: string, args: unknown[], headers: http.OutgoingHttpHeaders = { cookie: COOKIE }) =>
  request(port, { method: 'POST', path: `/rpc/${channel}`, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ args }) });

let started: ReturnType<typeof createApp> | undefined;

async function start(handlers: Record<string, Handler> = {}, extra: { attachment?: Parameters<typeof createApp>[0]['attachment']; maxBody?: number } = {}) {
  const dir = tempDir();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<h1>app</h1>');
  writeFileSync(join(dir, 'assets', 'a.js'), 'x');
  writeFileSync(join(dir, '..', 'secret.txt'), 'outside');
  started = createApp({ token: TOKEN, rendererDir: dir, handlers: new Map(Object.entries(handlers)), attachment: extra.attachment ?? (() => undefined), maxBody: extra.maxBody });
  await new Promise<void>((ok) => started!.server.listen(0, '127.0.0.1', ok));
  return { port: (started.server.address() as { port: number }).port, send: started.send, dir };
}

afterEach(async () => {
  if (!started) return;
  started.server.closeAllConnections();
  await new Promise((ok) => started!.server.close(ok));
  started = undefined;
});

describe('auth helpers', () => {
  it('loadToken: PA_TOKEN wins, else generates once and reads it back', () => {
    const file = join(tempDir(), 'token');
    expect(loadToken({ PA_TOKEN: ' abc ' }, file)).toBe('abc');
    const first = loadToken({}, file);
    expect(first.length).toBeGreaterThanOrEqual(24);
    expect(loadToken({}, file)).toBe(first);
    expect(readFileSync(file, 'utf8')).toBe(first);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('hostOk only accepts loopback names, any port', () => {
    expect(hostOk('localhost:3000')).toBe(true);
    expect(hostOk('127.0.0.1')).toBe(true);
    expect(hostOk('evil.example:3000')).toBe(false);
    expect(hostOk('localhost.evil.example')).toBe(false);
    expect(hostOk(undefined)).toBe(false);
  });

  it('originOk: same host or absent', () => {
    expect(originOk(undefined, 'localhost:3000')).toBe(true);
    expect(originOk('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(originOk('http://evil.example', 'localhost:3000')).toBe(false);
  });

  it('readCookie / cookieHeader', () => {
    expect(readCookie('a=1; pa_token=xyz; b=2', 'pa_token')).toBe('xyz');
    expect(readCookie(undefined, 'pa_token')).toBeUndefined();
    expect(cookieHeader('t')).toContain('HttpOnly');
    expect(cookieHeader('t')).toContain('SameSite=Strict');
  });
});

describe('server access control', () => {
  it('401 without the cookie on every route', async () => {
    const { port } = await start({ 'conv:list': () => [] });
    expect((await request(port, { path: '/' })).status).toBe(401);
    expect((await request(port, { path: '/events' })).status).toBe(401);
    expect((await request(port, { path: '/att/x' })).status).toBe(401);
    expect((await rpc(port, 'conv:list', [], {})).status).toBe(401);
    expect((await request(port, { path: '/', headers: { cookie: 'pa_token=wrong' } })).status).toBe(401);
  });

  it('403 for a foreign Host or Origin, even with the cookie', async () => {
    const { port } = await start({ 'conv:list': () => [] });
    expect((await request(port, { path: '/', headers: { host: 'evil.example', cookie: COOKIE } })).status).toBe(403);
    expect((await rpc(port, 'conv:list', [], { cookie: COOKIE, origin: 'http://evil.example' })).status).toBe(403);
  });

  it('?token= sets the cookie and redirects; a wrong token does not', async () => {
    const { port } = await start();
    const ok = await request(port, { path: `/?token=${TOKEN}` });
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('/');
    expect(String(ok.headers['set-cookie'])).toContain(`pa_token=${TOKEN}`);
    const bad = await request(port, { path: '/?token=nope' });
    expect(bad.status).toBe(401);
    expect(bad.headers['set-cookie']).toBeUndefined();
  });
});

describe('server routes', () => {
  it('rpc: runs the handler with decoded args and wraps the value', async () => {
    const { port } = await start({ echo: (...a: unknown[]) => ({ n: a.length, first: a[0] }), nothing: () => undefined });
    const r = JSON.parse((await rpc(port, 'echo', [1, 'x'])).body);
    expect(r).toEqual({ ok: true, value: { n: 2, first: 1 } });
    expect(JSON.parse((await rpc(port, 'nothing', [])).body)).toEqual({ ok: true, value: null });
  });

  it('rpc: $b64 becomes a Uint8Array', async () => {
    let seen: unknown;
    const { port } = await start({ bytes: (a: unknown) => (seen = a) });
    await rpc(port, 'bytes', [{ $b64: Buffer.from([1, 2, 3]).toString('base64') }]);
    expect(seen).toBeInstanceOf(Uint8Array);
    expect([...(seen as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('rpc: a throwing handler is ok:false with the message, an unknown channel is 404', async () => {
    const { port } = await start({
      boom: () => {
        throw new Error('nope');
      },
    });
    expect(JSON.parse((await rpc(port, 'boom', [])).body)).toEqual({ ok: false, error: 'nope' });
    expect((await rpc(port, 'missing', [])).status).toBe(404);
  });

  it('rpc: 413 over the body limit', async () => {
    const { port } = await start({ echo: () => 1 }, { maxBody: 100 });
    const r = await rpc(port, 'echo', ['x'.repeat(500)]);
    expect(r.status).toBe(413);
  });

  it('serves the renderer and refuses to leave its directory', async () => {
    const { port } = await start();
    const h = { cookie: COOKIE };
    const index = await request(port, { path: '/', headers: h });
    expect(index.status).toBe(200);
    expect(index.body).toBe('<h1>app</h1>');
    expect((await request(port, { path: '/assets/a.js', headers: h })).headers['content-type']).toContain('javascript');
    expect((await request(port, { path: '/nope.js', headers: h })).status).toBe(404);
    expect((await request(port, { path: '/..%2Fsecret.txt', headers: h })).status).toBe(404);
    expect((await request(port, { path: '/assets', headers: h })).status).toBe(404); // a directory
  });

  it('att: serves the file with its mime, 404 for an unknown id', async () => {
    const file = join(tempDir(), 'x.jpg');
    writeFileSync(file, 'jpegbytes');
    const { port } = await start({}, { attachment: (id) => (id === 'abc' ? { path: file, mime: 'image/jpeg' } : undefined) });
    const ok = await request(port, { path: '/att/abc', headers: { cookie: COOKIE } });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.body).toBe('jpegbytes');
    expect((await request(port, { path: '/att/zzz', headers: { cookie: COOKIE } })).status).toBe(404);
  });

  it('events: send() reaches a connected client as an SSE message', async () => {
    const { port, send } = await start();
    const got = await new Promise<string>((done, fail) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/events', headers: { host: `localhost:${port}`, cookie: COOKIE } }, (res) => {
        res.setEncoding('utf8');
        let acc = '';
        res.on('data', (c: string) => {
          acc += c;
          if (acc.includes('data:')) {
            req.destroy();
            done(acc);
          } else if (acc.includes(': ok')) send('data:changed', { a: 1 });
        });
      });
      req.on('error', (e) => (e as NodeJS.ErrnoException).code === 'ECONNRESET' || fail(e));
    });
    expect(got).toContain(`data: ${JSON.stringify({ channel: 'data:changed', payload: { a: 1 } })}`);
  });
});
