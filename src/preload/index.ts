import { contextBridge, ipcRenderer } from 'electron';
import type { Api, UiSettings } from '../shared/types';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const listen =
  <T>(channel: string) =>
  (cb: (value: T) => void) => {
    const listener = (_: unknown, value: T) => cb(value);
    ipcRenderer.on(channel, listener);
    return () => void ipcRenderer.removeListener(channel, listener);
  };

const api: Api = {
  conversations: {
    list: () => invoke('conv:list'),
    create: () => invoke('conv:create'),
    remove: (id) => invoke('conv:remove', id),
    rename: (id, title) => invoke('conv:rename', id, title),
  },
  chat: {
    messages: (id) => invoke('chat:messages', id),
    actions: (id) => invoke('chat:actions', id),
    send: (id, text, images) => invoke('chat:send', id, text, images),
    running: (id) => invoke('chat:running', id),
    stop: (id) => invoke('chat:stop', id),
    retry: (id) => invoke('chat:retry', id),
    resolve: (actionId, decision, args) => invoke('chat:resolve', actionId, decision, args),
    answer: (actionId, replies) => invoke('chat:answer', actionId, replies),
    onEvent: listen('chat:event'),
  },
  data: {
    read: (tool, args) => invoke('data:read', tool, args),
    write: (tool, args) => invoke('data:write', tool, args),
    save: (tool, args, images, removeIds) => invoke('data:save', tool, args, images, removeIds),
    onChanged: listen<void>('data:changed'),
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (s) => invoke('settings:save', s),
    test: () => invoke('settings:test'),
    listModels: (provider) => invoke('settings:listModels', provider),
    setOpenAtLogin: (on) => invoke('settings:setOpenAtLogin', on),
    setUi: (patch) => invoke('settings:setUi', patch),
  },
  update: {
    check: (manual) => invoke('update:check', manual),
    skip: (version) => invoke('update:skip', version),
    install: () => invoke('update:install'),
    onProgress: listen<number>('update:progress'),
  },
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:isMaximized'),
    onMaximizedChange: listen<boolean>('win:maximized'),
  },
  onNavigate: listen('nav'),
  onUiChanged: listen<UiSettings>('ui:changed'),
};

contextBridge.exposeInMainWorld('api', api);
