import type { ImageInput, SettingsInput, SettingsView, UiSettings } from '../shared/types';
import { type AgentDeps, answerAction, cancelOpenActions, resolveAction } from './agent';
import { runWithDocuments } from './docrun';
import { addDocumentMessage, checkDocument } from './documents';
import { newAttachmentId, saveAttachment } from './attachments';
import { type Db, tx } from './db';
import { i18n, setLanguage } from './i18n';
import { collect, createLlm, describeLlmError, listModels, LOCAL_KEY } from './llm';
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
import { checkForUpdate, skipVersion } from './update';
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
  /** Registers a handler; args arrive without the Electron event. */
  handle: (channel: string, fn: (...args: any[]) => unknown) => void;
  /** Electron: nativeImage; server: validate-only (the browser already resized). */
  toJpeg: (bytes: unknown) => Buffer;
  /** Electron: net.fetch (Windows cert store, system proxy); server: global fetch. */
  fetch: typeof fetch;
  home: string;
  version: string;
  /** False on the server: chat:send rejects `files: true`. */
  fileSearch: boolean;
  /** How the running app can install an update: by itself, by downloading the installer, or not at all (server). */
  installMode: () => { canInstall: boolean; manualInstall: boolean };
  /** Electron: nativeTheme.themeSource, so prefers-color-scheme follows the setting; the server has nothing to set. */
  setTheme: (theme: UiSettings['theme']) => void;
};

/** Writes the renderer may run directly: a click is the user's own intent (design D7). */
const UI_WRITES = new Set(['update_tasks', 'delete_tasks', 'update_reminders', 'delete_reminders', 'delete_notes', 'delete_expenses']);
const MAX_TEXT = 20_000;

/** Ids come from the renderer: reject anything but a positive integer (node:sqlite would throw on undefined anyway). */
function id(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new UserError('invalidId');
  return v;
}

export function registerIpc(m: MainCtx): void {
  const now = (): Date => new Date();
  const ctx = { db: m.db, ro: m.ro, now, settings: () => getUi(m.db) };
  const deps: AgentDeps = {
    ...ctx,
    attachmentsDir: m.attachmentsDir,
    home: m.home,
    emit: (e) => m.send('chat:event', e),
    llm: () => {
      const cfg = activeLlm(getLlm(m.db));
      return createLlm(cfg, readSecrets(m.secretsFile, m.cipher)[cfg.provider] ?? '', { fetch: m.fetch });
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
    const done = runWithDocuments(deps, conversationId, ctl.signal)
      .catch((e) => deps.emit({ type: 'error', conversationId, message: describeLlmError(e) }))
      .finally(() => {
        if (running.get(conversationId)?.ctl === ctl) running.delete(conversationId);
      });
    running.set(conversationId, { ctl, done });
  }

  m.handle('conv:list', () => listConversations(m.db));
  m.handle('conv:create', () => createConversation(m.db));
  m.handle('conv:remove', async (convId: unknown) => {
    const cid = id(convId);
    await stopTurn(cid);
    deleteConversation(m.db, cid);
  });
  m.handle('conv:rename', (convId: unknown, title: unknown) => {
    if (typeof title !== 'string' || title.length > MAX_TEXT) throw new UserError('invalidValue');
    renameConversation(m.db, id(convId), title);
  });

  m.handle('chat:messages', (convId: unknown) => getMessages(m.db, id(convId)));
  m.handle('chat:actions', (convId: unknown) => listActions(m.db, id(convId)));
  m.handle('chat:send', async (convId: unknown, text: unknown, images: ImageInput[], files?: unknown, document?: unknown) => {
    const cid = id(convId);
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new UserError('invalidMessage');
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new UserError('tooManyImages', { max: MAX_IMAGES });
    if (document != null && images.length) throw new UserError('pdfWithImages'); // docs/pdf-batch-reasoning-design.md P10
    if (!text.trim() && !images.length && document == null) throw new UserError('emptyMessage');
    if (files === true && !m.fileSearch) throw new UserError('notAllowed', { name: 'files' });
    const pdf = document == null ? null : checkDocument(document, m.toJpeg);
    const jpegs = images.map((img) => m.toJpeg(img?.bytes)); // validate everything before saving anything
    const attachmentIds = jpegs.map(() => newAttachmentId());
    await stopTurn(cid);
    // One transaction: a failed image save leaves no message pointing at missing attachments
    // (files already written become orphans, swept at startup).
    tx(m.db, () => {
      cancelOpenActions(deps, cid);
      if (pdf) addDocumentMessage(m.db, m.attachmentsDir, cid, text.trim(), pdf);
      else {
        const messageId = addMessage(m.db, cid, { role: 'user', content: text, attachment_ids: attachmentIds, ...(files === true ? { files: true } : {}) });
        jpegs.forEach((bytes, i) =>
          saveAttachment(m.db, m.attachmentsDir, { id: attachmentIds[i], bytes, mime: 'image/jpeg', ownerType: 'message', ownerId: messageId })
        );
      }
      setTitleIfNew(m.db, cid, text || pdf?.name || '');
    });
    startTurn(cid);
  });
  m.handle('chat:running', (convId: unknown) => running.has(id(convId)));
  m.handle('chat:stop', (convId: unknown) => stopTurn(id(convId)));
  m.handle('chat:retry', async (convId: unknown) => {
    const cid = id(convId);
    await stopTurn(cid);
    startTurn(cid);
  });
  m.handle('chat:resolve', async (actionId: unknown, decision: unknown, args?: unknown) => {
    if (decision !== 'confirm' && decision !== 'cancel') throw new UserError('invalidDecision');
    const action = getAction(m.db, id(actionId));
    const last = resolveAction(deps, id(actionId), decision, args);
    if (decision === 'confirm') m.onDataChanged();
    if (last && action) {
      await stopTurn(action.conversation_id);
      startTurn(action.conversation_id);
    }
  });
  m.handle('chat:answer', async (actionId: unknown, replies: unknown) => {
    const action = getAction(m.db, id(actionId));
    const last = answerAction(deps, id(actionId), replies); // no data changed, so no onDataChanged
    if (last && action) {
      await stopTurn(action.conversation_id);
      startTurn(action.conversation_id);
    }
  });

  m.handle('data:read', (name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'read') throw new UserError('notAllowed', { name: String(name) });
    return tool.run(parseArgs(tool, args), ctx);
  });
  m.handle('data:write', (name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'write' || !UI_WRITES.has(tool.name)) throw new UserError('notAllowed', { name: String(name) });
    const parsed = parseArgs(tool, args);
    const result = tx(m.db, () => tool.apply(parsed, ctx));
    m.onDataChanged();
    return result;
  });
  m.handle('data:save', (name: unknown, args: unknown, images: unknown = [], removeIds?: unknown) => {
    if (typeof name !== 'string' || !Object.hasOwn(SAVE_TOOLS, name)) throw new UserError('notAllowed', { name: String(name) }); // before decoding images
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new UserError('tooManyImages', { max: MAX_IMAGES });
    const jpegs = images.map((img: ImageInput) => m.toJpeg(img?.bytes)); // validate everything before saving anything
    const row = saveRecord({ ...ctx, attachmentsDir: m.attachmentsDir }, name, args, jpegs, removeIds);
    m.onDataChanged();
    return row;
  });

  m.handle('settings:get', (): SettingsView => {
    const ui = getUi(m.db); // first, so the renderer's language always matches main's
    let secrets: ReturnType<typeof readSecrets> = {};
    try {
      secrets = readSecrets(m.secretsFile, m.cipher);
    } catch (e) {
      console.error('Reading secrets failed', e); // show "no key" rather than failing the whole settings view
    }
    return {
      llm: getLlm(m.db),
      hasKey: { azure: !!secrets.azure, gateway: !!secrets.gateway, lmstudio: !!secrets.lmstudio },
      openAtLogin: m.loginItem.get(),
      ui,
      version: m.version,
    };
  });
  m.handle('settings:save', (s: SettingsInput) => {
    const llm = parseLlmSettings(s?.llm);
    if (s.apiKey !== undefined && typeof s.apiKey !== 'string') throw new UserError('invalidApiKey');
    setSetting(m.db, 'llm', llm);
    const key = s.apiKey?.trim();
    if (key) writeSecret(m.secretsFile, m.cipher, llm.active, key);
  });
  m.handle('settings:listModels', async (provider: unknown) => {
    if (provider !== 'gateway' && provider !== 'lmstudio') throw new UserError('invalidValue'); // Azure has deployments, not a list (design G2)
    const key = readSecrets(m.secretsFile, m.cipher)[provider] || (provider === 'lmstudio' ? LOCAL_KEY : '');
    return listModels(getLlm(m.db)[provider].endpoint, key, { fetch: m.fetch }).catch((e: unknown) => {
      throw e instanceof UserError ? e : new Error(te('modelsFailed', { error: describeLlmError(e) }));
    });
  });
  m.handle('settings:setUi', (patch: unknown) => {
    const ui = saveUi(m.db, patch);
    setLanguage(ui.language);
    m.setTheme(ui.theme);
    m.send('ui:changed', ui);
    return ui;
  });
  m.handle('update:check', async (manual: unknown) => ({
    ...(await checkForUpdate(m.db, { fetch: m.fetch, version: m.version, now: Date.now(), manual: manual === true })),
    ...m.installMode(),
  }));
  m.handle('update:skip', (version: unknown) => skipVersion(m.db, version));
  m.handle('settings:test', async () => {
    try {
      const reply = await collect(deps.llm().stream({ messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }] }), () => {});
      return reply.content ?? i18n.t('common:empty');
    } catch (e) {
      throw new Error(describeLlmError(e));
    }
  });
}
