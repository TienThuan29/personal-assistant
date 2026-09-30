import { ipcMain, nativeImage, net } from 'electron';
import type { ImageInput, SettingsInput, SettingsView } from '../shared/types';
import { type AgentDeps, cancelOpenActions, resolveAction, runTurn } from './agent';
import { newAttachmentId, saveAttachment } from './attachments';
import { type Db, tx } from './db';
import { i18n, setLanguage } from './i18n';
import { collect, createLlm, describeLlmError, listModels } from './llm';
import { MAX_IMAGES, SAVE_TOOLS, saveRecord } from './save';
import { activeLlm, type Cipher, getLlm, getUi, parseLlmSettings, readSecrets, saveUi, setSetting, writeSecret } from './settings';
import {
  addMessage,
  createConversation,
  deleteConversation,
  getAction,
  getMessages,
  listActions,
  listConversations,
  renameConversation,
  setTitleIfNew,
} from './store';
import { findTool, parseArgs } from './tools';
import { te, UserError } from './errors';

export type MainCtx = {
  db: Db;
  ro: Db;
  attachmentsDir: string;
  secretsFile: string;
  cipher: Cipher;
  /** Sends to the window if it is still alive. */
  send: (channel: string, payload?: unknown) => void;
  onDataChanged: () => void;
  loginItem: { get: () => boolean; set: (on: boolean) => void };
};

/** Writes the renderer may run directly: a click is the user's own intent (design D7). */
const UI_WRITES = new Set(['update_tasks', 'delete_tasks', 'update_reminders', 'delete_reminders', 'delete_notes', 'delete_expenses']);
const MAX_TEXT = 20_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1568;
// Chromium's network stack: trusts the Windows certificate store and uses the system proxy, so corporate TLS inspection
// works. Node's own fetch fails there with UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
const netFetch = net.fetch as unknown as typeof fetch;

/** Ids come from the renderer: reject anything but a positive integer (node:sqlite would throw on undefined anyway). */
function id(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new UserError('invalidId');
  return v;
}

/** PNG/JPEG → JPEG with the longest side ≤ 1568px (vision models downscale to about that anyway). */
function toJpeg(bytes: unknown): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) throw new UserError('invalidImage', { mb: MAX_IMAGE_BYTES / 1024 / 1024 });
  let img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new UserError('imageType');
  const { width, height } = img.getSize();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' });
  return img.toJPEG(85);
}

export function registerIpc(m: MainCtx): void {
  const now = (): Date => new Date();
  const ctx = { db: m.db, ro: m.ro, now, settings: () => getUi(m.db) };
  const deps: AgentDeps = {
    ...ctx,
    attachmentsDir: m.attachmentsDir,
    emit: (e) => m.send('chat:event', e),
    llm: () => {
      const cfg = activeLlm(getLlm(m.db));
      return createLlm(cfg, readSecrets(m.secretsFile, m.cipher)[cfg.provider] ?? '', { fetch: netFetch });
    },
  };
  const running = new Map<number, { ctl: AbortController; done: Promise<void> }>();

  /** Aborts a running turn and waits until it has saved its partial reply, so that reply never lands after what comes next. */
  async function stopTurn(conversationId: number): Promise<void> {
    const r = running.get(conversationId);
    if (!r) return;
    r.ctl.abort();
    await r.done;
  }

  function startTurn(conversationId: number): void {
    running.get(conversationId)?.ctl.abort(); // only if two requests raced past stopTurn
    const ctl = new AbortController();
    const done = runTurn(deps, conversationId, ctl.signal)
      .catch((e) => deps.emit({ type: 'error', conversationId, message: describeLlmError(e) }))
      .finally(() => {
        if (running.get(conversationId)?.ctl === ctl) running.delete(conversationId);
      });
    running.set(conversationId, { ctl, done });
  }

  ipcMain.handle('conv:list', () => listConversations(m.db));
  ipcMain.handle('conv:create', () => createConversation(m.db));
  ipcMain.handle('conv:remove', async (_e, convId: unknown) => {
    const cid = id(convId);
    await stopTurn(cid);
    deleteConversation(m.db, cid);
  });
  ipcMain.handle('conv:rename', (_e, convId: unknown, title: unknown) => {
    if (typeof title !== 'string') throw new UserError('invalidValue');
    renameConversation(m.db, id(convId), title);
  });

  ipcMain.handle('chat:messages', (_e, convId: unknown) => getMessages(m.db, id(convId)));
  ipcMain.handle('chat:actions', (_e, convId: unknown) => listActions(m.db, id(convId)));
  ipcMain.handle('chat:send', async (_e, convId: unknown, text: unknown, images: ImageInput[]) => {
    const cid = id(convId);
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new UserError('invalidMessage');
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new UserError('tooManyImages', { max: MAX_IMAGES });
    if (!text.trim() && !images.length) throw new UserError('emptyMessage');
    const jpegs = images.map((img) => toJpeg(img?.bytes)); // validate everything before saving anything
    const attachmentIds = jpegs.map(() => newAttachmentId());
    await stopTurn(cid);
    // One transaction: a failed image save leaves no message pointing at missing attachments
    // (files already written become orphans, swept at startup).
    tx(m.db, () => {
      cancelOpenActions(deps, cid);
      const messageId = addMessage(m.db, cid, { role: 'user', content: text, attachment_ids: attachmentIds });
      jpegs.forEach((bytes, i) =>
        saveAttachment(m.db, m.attachmentsDir, { id: attachmentIds[i], bytes, mime: 'image/jpeg', ownerType: 'message', ownerId: messageId })
      );
      setTitleIfNew(m.db, cid, text);
    });
    startTurn(cid);
  });
  ipcMain.handle('chat:running', (_e, convId: unknown) => running.has(id(convId)));
  ipcMain.handle('chat:stop', (_e, convId: unknown) => stopTurn(id(convId)));
  ipcMain.handle('chat:retry', async (_e, convId: unknown) => {
    const cid = id(convId);
    await stopTurn(cid);
    startTurn(cid);
  });
  ipcMain.handle('chat:resolve', async (_e, actionId: unknown, decision: unknown, args?: unknown) => {
    if (decision !== 'confirm' && decision !== 'cancel') throw new UserError('invalidDecision');
    const action = getAction(m.db, id(actionId));
    const last = resolveAction(deps, id(actionId), decision, args);
    if (decision === 'confirm') m.onDataChanged();
    if (last && action) {
      await stopTurn(action.conversation_id);
      startTurn(action.conversation_id);
    }
  });

  ipcMain.handle('data:read', (_e, name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'read') throw new UserError('notAllowed', { name: String(name) });
    return tool.run(parseArgs(tool, args), ctx);
  });
  ipcMain.handle('data:write', (_e, name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'write' || !UI_WRITES.has(tool.name)) throw new UserError('notAllowed', { name: String(name) });
    const parsed = parseArgs(tool, args);
    const result = tx(m.db, () => tool.apply(parsed, ctx));
    m.onDataChanged();
    return result;
  });
  ipcMain.handle('data:save', (_e, name: unknown, args: unknown, images: unknown = [], removeIds?: unknown) => {
    if (typeof name !== 'string' || !Object.hasOwn(SAVE_TOOLS, name)) throw new UserError('notAllowed', { name: String(name) }); // before decoding images
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new UserError('tooManyImages', { max: MAX_IMAGES });
    const jpegs = images.map((img: ImageInput) => toJpeg(img?.bytes)); // validate everything before saving anything
    const row = saveRecord({ ...ctx, attachmentsDir: m.attachmentsDir }, name, args, jpegs, removeIds);
    m.onDataChanged();
    return row;
  });

  ipcMain.handle('settings:get', (): SettingsView => {
    const ui = getUi(m.db); // first, so the renderer's language always matches main's
    let secrets: ReturnType<typeof readSecrets> = {};
    try {
      secrets = readSecrets(m.secretsFile, m.cipher);
    } catch (e) {
      console.error('Reading secrets failed', e); // show "no key" rather than failing the whole settings view
    }
    return {
      llm: getLlm(m.db),
      hasKey: { azure: !!secrets.azure, gateway: !!secrets.gateway },
      openAtLogin: m.loginItem.get(),
      ui,
    };
  });
  ipcMain.handle('settings:save', (_e, s: SettingsInput) => {
    const llm = parseLlmSettings(s?.llm);
    if (s.apiKey !== undefined && typeof s.apiKey !== 'string') throw new UserError('invalidApiKey');
    setSetting(m.db, 'llm', llm);
    const key = s.apiKey?.trim();
    if (key) writeSecret(m.secretsFile, m.cipher, llm.active, key);
  });
  ipcMain.handle('settings:listModels', async (_e, provider: unknown) => {
    if (provider !== 'gateway') throw new UserError('invalidValue'); // only a gateway lists its models (design G2)
    const key = readSecrets(m.secretsFile, m.cipher).gateway ?? '';
    return listModels(getLlm(m.db).gateway.endpoint, key, { fetch: netFetch }).catch((e: unknown) => {
      throw e instanceof UserError ? e : new Error(te('modelsFailed', { error: describeLlmError(e) }));
    });
  });
  ipcMain.handle('settings:setOpenAtLogin', (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new UserError('invalidValue');
    m.loginItem.set(on);
    return m.loginItem.get();
  });
  ipcMain.handle('settings:setUi', (_e, patch: unknown) => {
    const ui = saveUi(m.db, patch);
    setLanguage(ui.language);
    m.send('ui:changed', ui);
    return ui;
  });
  ipcMain.handle('settings:test', async () => {
    try {
      const reply = await collect(deps.llm().stream({ messages: [{ role: 'user', content: 'Trả lời đúng một từ: OK' }] }), () => {});
      return reply.content ?? i18n.t('common:empty');
    } catch (e) {
      throw new Error(describeLlmError(e));
    }
  });
}
