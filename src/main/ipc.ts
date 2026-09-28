import { type BrowserWindow, ipcMain, nativeImage } from 'electron';
import { z } from 'zod/v4';
import { DEFAULT_LLM, type ImageInput, type LlmConfig, type SettingsInput, type SettingsView } from '../shared/types';
import { type AgentDeps, cancelOpenActions, resolveAction, runTurn } from './agent';
import { newAttachmentId, saveAttachment } from './attachments';
import { type Db, tx } from './db';
import { collect, createLlm, describeLlmError } from './llm';
import { type Cipher, getSetting, llmConfigSchema, readSecrets, setSetting, writeSecret } from './settings';
import {
  addMessage,
  createConversation,
  deleteConversation,
  getAction,
  getMessages,
  listActions,
  listConversations,
  setTitleIfNew,
} from './store';
import { findTool, parseArgs } from './tools';

export type MainCtx = {
  db: Db;
  ro: Db;
  attachmentsDir: string;
  secretsFile: string;
  cipher: Cipher;
  win: () => BrowserWindow | undefined;
  onDataChanged: () => void;
  loginItem: { get: () => boolean; set: (on: boolean) => void };
};

/** Writes the renderer may run directly: a click is the user's own intent (design D7). */
const UI_WRITES = new Set(['update_tasks', 'delete_tasks', 'update_reminders', 'delete_reminders', 'delete_notes', 'delete_expenses']);
const MAX_TEXT = 20_000;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1568;

/** Ids come from the renderer: reject anything but a positive integer (node:sqlite would throw on undefined anyway). */
function id(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error('ID không hợp lệ');
  return v;
}

/** PNG/JPEG → JPEG with the longest side ≤ 1568px (vision models downscale to about that anyway). */
function toJpeg(bytes: unknown): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Ảnh không hợp lệ hoặc lớn hơn 20MB');
  let img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (img.isEmpty()) throw new Error('Chỉ hỗ trợ ảnh PNG hoặc JPEG');
  const { width, height } = img.getSize();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' });
  return img.toJPEG(85);
}

export function registerIpc(m: MainCtx): void {
  const now = (): Date => new Date();
  const ctx = { db: m.db, ro: m.ro, now };
  const llmConfig = (): LlmConfig => getSetting(m.db, 'llm', DEFAULT_LLM);
  const deps: AgentDeps = {
    ...ctx,
    attachmentsDir: m.attachmentsDir,
    emit: (e) => m.win()?.webContents.send('chat:event', e),
    llm: () => {
      const cfg = llmConfig();
      return createLlm(cfg, readSecrets(m.secretsFile, m.cipher)[cfg.provider] ?? '');
    },
  };
  const running = new Map<number, AbortController>();

  function startTurn(conversationId: number): void {
    running.get(conversationId)?.abort();
    const ctl = new AbortController();
    running.set(conversationId, ctl);
    void runTurn(deps, conversationId, ctl.signal)
      .catch((e) => deps.emit({ type: 'error', conversationId, message: describeLlmError(e) }))
      .finally(() => {
        if (running.get(conversationId) === ctl) running.delete(conversationId);
      });
  }

  ipcMain.handle('conv:list', () => listConversations(m.db));
  ipcMain.handle('conv:create', () => createConversation(m.db));
  ipcMain.handle('conv:remove', (_e, convId: unknown) => {
    running.get(id(convId))?.abort();
    deleteConversation(m.db, id(convId));
  });

  ipcMain.handle('chat:messages', (_e, convId: unknown) => getMessages(m.db, id(convId)));
  ipcMain.handle('chat:actions', (_e, convId: unknown) => listActions(m.db, id(convId)));
  ipcMain.handle('chat:send', (_e, convId: unknown, text: unknown, images: ImageInput[]) => {
    const cid = id(convId);
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Tin nhắn không hợp lệ');
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`Tối đa ${MAX_IMAGES} ảnh mỗi tin nhắn`);
    if (!text.trim() && !images.length) throw new Error('Tin nhắn trống');
    const jpegs = images.map((img) => toJpeg(img?.bytes)); // validate everything before saving anything
    const attachmentIds = jpegs.map(() => newAttachmentId());
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
  ipcMain.handle('chat:stop', (_e, convId: unknown) => running.get(id(convId))?.abort());
  ipcMain.handle('chat:retry', (_e, convId: unknown) => startTurn(id(convId)));
  ipcMain.handle('chat:resolve', (_e, actionId: unknown, decision: unknown, args?: unknown) => {
    if (decision !== 'confirm' && decision !== 'cancel') throw new Error('Quyết định không hợp lệ');
    const action = getAction(m.db, id(actionId));
    const last = resolveAction(deps, id(actionId), decision, args);
    if (decision === 'confirm') m.onDataChanged();
    if (last && action) startTurn(action.conversation_id);
  });

  ipcMain.handle('data:read', (_e, name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'read') throw new Error(`Không cho phép: ${String(name)}`);
    return tool.run(parseArgs(tool, args), ctx);
  });
  ipcMain.handle('data:write', (_e, name: unknown, args: unknown) => {
    const tool = typeof name === 'string' ? findTool(name) : undefined;
    if (tool?.kind !== 'write' || !UI_WRITES.has(tool.name)) throw new Error(`Không cho phép: ${String(name)}`);
    const parsed = parseArgs(tool, args);
    const result = tx(m.db, () => tool.apply(parsed, ctx));
    m.onDataChanged();
    return result;
  });

  ipcMain.handle('settings:get', (): SettingsView => {
    const secrets = readSecrets(m.secretsFile, m.cipher);
    return { llm: llmConfig(), hasKey: { azure: !!secrets.azure, gateway: !!secrets.gateway }, openAtLogin: m.loginItem.get() };
  });
  ipcMain.handle('settings:save', (_e, s: SettingsInput) => {
    const parsed = llmConfigSchema.safeParse(s?.llm);
    if (!parsed.success) throw new Error(`Cấu hình chưa hợp lệ: ${z.prettifyError(parsed.error)}`);
    if (s.apiKey !== undefined && typeof s.apiKey !== 'string') throw new Error('API key không hợp lệ');
    setSetting(m.db, 'llm', parsed.data);
    const key = s.apiKey?.trim();
    if (key) writeSecret(m.secretsFile, m.cipher, parsed.data.provider, key);
    m.loginItem.set(!!s.openAtLogin);
  });
  ipcMain.handle('settings:test', async () => {
    try {
      const reply = await collect(deps.llm().stream({ messages: [{ role: 'user', content: 'Trả lời đúng một từ: OK' }] }), () => {});
      return reply.content ?? '(trống)';
    } catch (e) {
      throw new Error(describeLlmError(e));
    }
  });
}
