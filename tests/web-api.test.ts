import { describe, expect, it, vi } from 'vitest';
import { createWebApi } from '../src/renderer/web-api';

/** Just enough EventSource: tests drive open/error/message by hand. */
class FakeEventSource {
  static last: FakeEventSource;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  onopen?: () => void;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  emit(channel: string, payload?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ channel, payload }) });
  }
}

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function make(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const reload = vi.fn();
  const fetchMock = vi.fn(fetchImpl);
  const api = createWebApi({ fetch: fetchMock as unknown as typeof fetch, EventSource: FakeEventSource as unknown as typeof EventSource, reload });
  return { api, reload, fetchMock };
}

describe('createWebApi', () => {
  it('invoke posts args to /rpc/<channel> and returns the value', async () => {
    const { api, fetchMock } = make(() => reply({ ok: true, value: [{ id: 1 }] }));
    expect(await api.conversations.list()).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/rpc/conv:list');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ args: [] });
  });

  it('an application error becomes an Error with the server message', async () => {
    const { api } = make(() => reply({ ok: false, error: 'Nope' }));
    await expect(api.chat.stop(1)).rejects.toThrow('Nope');
  });

  it('401 and a non-JSON reply are reported', async () => {
    await expect(make(() => reply({ ok: false }, 401)).api.chat.stop(1)).rejects.toThrow(/Unauthorized/);
    await expect(make(() => Promise.resolve(new Response('<html>', { status: 502 }))).api.chat.stop(1)).rejects.toThrow(/502/);
  });

  it('Uint8Array travels as {$b64}', async () => {
    const { fetchMock, api } = make(() => reply({ ok: true, value: null }));
    // createImageBitmap does not exist in Node, so the image is sent as it is.
    await api.data.save('create_task', { title: 'x' }, [{ name: 'a.jpg', bytes: new Uint8Array([1, 2, 3]) }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.args[2][0].bytes).toEqual({ $b64: 'AQID' });
  });

  it('routes SSE messages to the right listener and stops after unsubscribe', () => {
    const { api } = make(() => reply({ ok: true }));
    const changed = vi.fn();
    const events = vi.fn();
    const off = api.data.onChanged(changed);
    api.chat.onEvent(events);
    FakeEventSource.last.emit('data:changed');
    FakeEventSource.last.emit('chat:event', { type: 'done', conversationId: 1 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith({ type: 'done', conversationId: 1 });
    off();
    FakeEventSource.last.emit('data:changed');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reloads once when the stream reconnects, not on the first open', () => {
    const { api, reload } = make(() => reply({ ok: true }));
    api.data.onChanged(() => {});
    const es = FakeEventSource.last;
    es.onopen?.();
    expect(reload).not.toHaveBeenCalled();
    es.onerror?.();
    es.onopen?.();
    expect(reload).toHaveBeenCalledTimes(1);
    es.onopen?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('is the web variant and has no desktop-only powers', async () => {
    const { api } = make(() => reply({ ok: true }));
    expect(api.web).toBe(true);
    expect(await api.settings.setOpenAtLogin(true)).toBe(false);
    expect(await api.win.isMaximized()).toBe(false);
    await expect(api.files.reveal('/x')).rejects.toThrow();
    await expect(api.update.install()).rejects.toThrow();
  });
});
