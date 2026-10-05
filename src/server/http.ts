import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { errMsg } from '../main/errors';
import { COOKIE, cookieHeader, hostOk, originOk, readCookie, sameToken } from './auth';

export const MAX_BODY = 32 * 1024 * 1024;
const HEARTBEAT_MS = 25_000;

export type Handler = (...args: any[]) => unknown;
export type AppOpts = {
  token: string;
  /** Built renderer (out/renderer). */
  rendererDir: string;
  handlers: Map<string, Handler>;
  attachment: (id: string) => { path: string; mime: string } | undefined;
  /** Request body limit in bytes (default 32 MB); tests lower it. */
  maxBody?: number;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Bytes arrive as {"$b64": "..."} (the browser shim's encoding of Uint8Array) and become Buffers, which are Uint8Arrays. */
const reviver = (_k: string, v: unknown): unknown => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$b64' && typeof (v as { $b64: unknown }).$b64 === 'string') {
      return Buffer.from((v as { $b64: string }).$b64, 'base64');
    }
  }
  return v;
};

function readBody(req: http.IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit keep draining without storing, so the client can finish sending and read the 413.
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => done(size > max ? undefined : Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function text(res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendFile(res: http.ServerResponse, path: string, mime: string, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(200, { 'content-type': mime, 'content-length': statSync(path).size, ...headers });
  createReadStream(path).pipe(res);
}

/** The HTTP side of Docker mode (docs/docker-design.md D2, D6): static renderer, POST /rpc/<channel>, SSE /events, GET /att/<id>. */
export function createApp(opts: AppOpts): { server: http.Server; send: (channel: string, payload?: unknown) => void } {
  const clients = new Set<http.ServerResponse>();
  const root = resolve(opts.rendererDir);

  const send = (channel: string, payload?: unknown): void => {
    const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const c of clients) c.write(line);
  };
  const beat = setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), HEARTBEAT_MS);
  beat.unref();

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (!hostOk(host)) return text(res, 403, 'Forbidden');
    if (req.method === 'POST' && !originOk(req.headers.origin, host)) return text(res, 403, 'Forbidden');

    const url = new URL(req.url ?? '/', `http://${host}`);
    const given = url.searchParams.get('token');
    if (req.method === 'GET' && url.pathname === '/' && given !== null && sameToken(given, opts.token)) {
      res.writeHead(302, { location: '/', 'set-cookie': cookieHeader(opts.token) });
      return void res.end();
    }

    const cookie = readCookie(req.headers.cookie, COOKIE);
    if (cookie === undefined || !sameToken(cookie, opts.token)) {
      if (/^\/(rpc|events|att)\b/.test(url.pathname)) return json(res, 401, { ok: false, error: 'Unauthorized' });
      return text(res, 401, 'Unauthorized. Open the URL with ?token=… that this container printed in `docker logs`.');
    }

    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      const channel = decodeURIComponent(url.pathname.slice('/rpc/'.length));
      const fn = opts.handlers.get(channel);
      if (!fn) return json(res, 404, { ok: false, error: `Unknown channel: ${channel}` });
      const body = await readBody(req, opts.maxBody ?? MAX_BODY);
      if (body === undefined) return json(res, 413, { ok: false, error: 'Request too large' });
      try {
        const { args } = JSON.parse(body, reviver) as { args?: unknown };
        if (!Array.isArray(args)) return json(res, 400, { ok: false, error: 'Bad request' });
        return json(res, 200, { ok: true, value: (await fn(...args)) ?? null });
      } catch (e) {
        // 200: an application error (UserError, validation) is not a transport failure; the shim rethrows it.
        return json(res, 200, { ok: false, error: errMsg(e) });
      }
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/att/')) {
      const file = opts.attachment(decodeURIComponent(url.pathname.slice('/att/'.length)));
      return file ? sendFile(res, file.path, file.mime, { 'x-content-type-options': 'nosniff' }) : text(res, 404, 'Not found');
    }

    if (req.method === 'GET') {
      const rel = decodeURIComponent(url.pathname);
      const path = resolve(join(root, rel === '/' ? 'index.html' : rel));
      if ((path !== root && !path.startsWith(root + sep)) || !existsSync(path) || !statSync(path).isFile()) return text(res, 404, 'Not found');
      return sendFile(res, path, MIME[extname(path)] ?? 'application/octet-stream', path.endsWith('index.html') ? { 'cache-control': 'no-cache' } : {});
    }

    return text(res, 404, 'Not found');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      console.error('Request failed', e);
      if (!res.headersSent) text(res, 500, 'Internal error');
      else res.end();
    });
  });
  server.on('close', () => clearInterval(beat));
  return { server, send };
}
