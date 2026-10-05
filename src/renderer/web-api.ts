import type { Api, ImageInput } from '../shared/types';

// `window.api` for a browser (Docker mode, docs/docker-design.md): the same Api the preload builds over Electron IPC,
// built over POST /rpc/<channel> and the /events SSE stream instead.

type Deps = {
  fetch: typeof fetch;
  EventSource: typeof EventSource;
  /** Called when the event stream reconnects (D15). */
  reload: () => void;
};

const MAX_SIDE = 1568;
const notInBrowser = () => Promise.reject(new Error('Not available in the browser'));

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Uint8Array travels as {"$b64": …}; the server turns it back into bytes. */
const replacer = (_k: string, v: unknown): unknown => (v instanceof Uint8Array ? { $b64: toB64(v) } : v);

/**
 * Resizes to ≤1568px and encodes JPEG here, since the server has no image library (D11). A file the browser cannot decode is
 * sent as it is, so the server's own check rejects it with its translated message.
 */
async function toJpeg(img: ImageInput): Promise<ImageInput> {
  try {
    const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart]));
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const [w, h] = [Math.round(bmp.width * scale), Math.round(bmp.height * scale)];
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // JPEG has no alpha
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return { name: img.name, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } catch {
    return img;
  }
}

export function createWebApi(deps: Partial<Deps> = {}): Api {
  const doFetch: typeof fetch = deps.fetch ?? ((...a) => fetch(...a));
  const reload = deps.reload ?? (() => location.reload());

  async function invoke(channel: string, ...args: unknown[]): Promise<any> {
    const res = await doFetch(`/rpc/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }, replacer) });
    if (res.status === 401) throw new Error('Unauthorized: open the URL with ?token=… that the container printed in docker logs');
    const r = (await res.json().catch(() => undefined)) as { ok: boolean; value?: unknown; error?: string } | undefined;
    if (!r) throw new Error(`Server error (${res.status})`);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }

  const listeners = new Map<string, Set<(payload: any) => void>>();
  let source: EventSource | undefined;
  let dropped = false;
  function connect(): void {
    if (source) return;
    source = new (deps.EventSource ?? EventSource)('/events');
    source.onmessage = (e) => {
      const { channel, payload } = JSON.parse(e.data) as { channel: string; payload?: unknown };
      listeners.get(channel)?.forEach((cb) => cb(payload));
    };
    source.onerror = () => {
      dropped = true; // EventSource retries by itself
    };
    source.onopen = () => {
      if (dropped) {
        dropped = false;
        reload(); // events were missed (a chat turn may have finished meanwhile); the DB is the truth. Also loads the new JS after an update.
      }
    };
  }
  const listen =
    <T>(channel: string) =>
    (cb: (value: T) => void) => {
      connect();
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(cb);
      return () => void set.delete(cb);
    };
  const jpegs = (images: ImageInput[] = []) => Promise.all(images.map(toJpeg));

  return {
    conversations: {
      list: () => invoke('conv:list'),
      create: () => invoke('conv:create'),
      remove: (id) => invoke('conv:remove', id),
      rename: (id, title) => invoke('conv:rename', id, title),
    },
    chat: {
      messages: (id) => invoke('chat:messages', id),
      actions: (id) => invoke('chat:actions', id),
      send: async (id, text, images, files, document) =>
        invoke('chat:send', id, text, await jpegs(images), files, document && { ...document, pages: await jpegs(document.pages) }),
      running: (id) => invoke('chat:running', id),
      stop: (id) => invoke('chat:stop', id),
      retry: (id) => invoke('chat:retry', id),
      resolve: (actionId, decision, args) => invoke('chat:resolve', actionId, decision, args),
      answer: (actionId, replies) => invoke('chat:answer', actionId, replies),
      onEvent: listen('chat:event'),
    },
    files: { reveal: notInBrowser },
    data: {
      read: (tool, args) => invoke('data:read', tool, args),
      write: (tool, args) => invoke('data:write', tool, args),
      save: async (tool, args, images, removeIds) => invoke('data:save', tool, args, await jpegs(images), removeIds),
      onChanged: listen<void>('data:changed'),
    },
    settings: {
      get: () => invoke('settings:get'),
      save: (s) => invoke('settings:save', s),
      test: () => invoke('settings:test'),
      listModels: (provider) => invoke('settings:listModels', provider),
      setOpenAtLogin: () => Promise.resolve(false),
      setUi: (patch) => invoke('settings:setUi', patch),
      dataPath: () => Promise.resolve(''),
      revealData: notInBrowser,
    },
    update: {
      check: (manual) => invoke('update:check', manual),
      skip: (version) => invoke('update:skip', version),
      install: notInBrowser,
      onProgress: listen<number>('update:progress'),
    },
    win: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: listen<boolean>('win:maximized'),
    },
    platform: 'web', // neither 'darwin' (traffic-light padding) nor a desktop with its own window buttons: those are hidden when `web`
    web: true,
    onReminder: listen('reminder'),
    onNavigate: listen('nav'),
    onUiChanged: listen('ui:changed'),
  };
}
