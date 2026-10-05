// Types shared by main, preload and renderer. No runtime code except constants.

import type { Lang } from './i18n';

export type TaskRow = {
  id: number;
  title: string;
  notes: string | null;
  category: string;
  priority: 1 | 2 | 3;
  due_date: string | null;
  due_time: string | null;
  status: 'todo' | 'done' | 'cancelled';
  recurrence: string | null;
  created_at: string;
  completed_at: string | null;
  attachment_ids?: string | null;
};

export type ReminderRow = {
  id: number;
  task_id: number | null;
  message: string;
  remind_at: string;
  status: 'pending' | 'fired' | 'dismissed';
};

export type NoteRow = {
  id: number;
  kind: 'note' | 'journal';
  title: string | null;
  body?: string;
  snippet?: string;
  created_at: string;
  updated_at: string;
  attachment_ids?: string | null;
};

export type ExpenseRow = {
  id: number;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  spent_at: string;
  created_at: string;
  attachment_ids?: string | null;
};

export type ExpenseList = { items: ExpenseRow[]; totals: { currency: string; total: number }[] };

export type ConversationRow = { id: number; title: string; updated_at: string };
/** The conversations.title default in migrations.ts; the renderer shows it translated. */
export const DEFAULT_CONVERSATION_TITLE = 'Hội thoại mới';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
/** A PDF sent with a message: `pages` are attachment ids in page order (docs/pdf-batch-reasoning-design.md). */
export type PdfDoc = { name: string; pages: string[] };
/** An internal message carrying one batch of a PDF's pages (1-based, inclusive). Hidden in the chat, sent to the model. */
export type BatchInfo = { name: string; part: number; parts: number; from: number; to: number; total: number };
/**
 * `files`: the user turned on file search for this message (docs/file-search-design.md).
 * `document`: the message came with a PDF. `batch` / `final` mark the internal messages of its batch run: the pages of one
 * batch (in `attachment_ids`), and the request to combine the notes.
 */
export type UserMessage = {
  role: 'user';
  content: string;
  attachment_ids?: string[];
  files?: true;
  document?: PdfDoc;
  batch?: BatchInfo;
  final?: true;
};
export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
export type ToolMessage = { role: 'tool'; tool_call_id: string; content: string };
export type StoredMessage = UserMessage | AssistantMessage | ToolMessage;
export type ChatMessage = StoredMessage & { id: number; created_at: string };

export type PendingAction = {
  id: number;
  conversation_id: number;
  /** The assistant message holding the tool call; null on rows from before migration 2. */
  message_id: number | null;
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  preview: unknown;
  status: 'pending' | 'confirmed' | 'cancelled';
  result: unknown;
};

/** The tool the model calls to ask the user (docs/ask-user-design.md). The card always adds an Other row, so `options` never holds one. */
export const ASK_TOOL = 'ask_user';
export type AskQuestion = { question: string; options: string[]; multiple: boolean };
/** What the card sends back for one question: ticked options and/or free text. */
export type AskReply = { picked: string[]; other?: string };
/** What the model receives, and what an answered card shows. */
export type AskAnswer = AskReply & { question: string };

/** The read-only file tools (src/main/tools/files.ts); the chat lists what each call searched or read. */
export const FILE_TOOL_NAMES = ['find_files', 'grep_files', 'read_file'];

/** Where a PDF run is: batch `part` of `parts` (pages `from`–`to` of `total`), or the final step that combines the notes. */
export type PdfProgress = { phase: 'batch' | 'final'; part: number; parts: number; from: number; to: number; total: number };

export type AgentEvent = { conversationId: number } & (
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'reasoning'; delta: string }
  | ({ type: 'progress' } & PdfProgress)
  | { type: 'saved' }
  | { type: 'pending' }
  | { type: 'done' }
  | { type: 'error'; message: string }
);

export type Provider = 'azure' | 'gateway' | 'lmstudio';
/** One provider's connection, resolved from LlmSettings for createLlm. A gateway's apiVersion is ''. */
export type LlmConfig = { provider: Provider; endpoint: string; model: string; apiVersion: string };
/** Stored under the settings key 'llm': one config per provider, so switching never overwrites the other (design G1). */
export type LlmSettings = {
  active: Provider;
  azure: { endpoint: string; model: string; apiVersion: string };
  gateway: { endpoint: string; model: string };
  /** LM Studio's local server: needs no key, and the model may be left empty to use the one loaded. */
  lmstudio: { endpoint: string; model: string };
};
/** Product names, the same in every language. */
export const PROVIDER_NAMES: Record<Provider, string> = { azure: 'Azure AI Foundry', gateway: 'LLM gateway', lmstudio: 'LM Studio' };
export const DEFAULT_LLM: LlmSettings = {
  active: 'gateway',
  azure: { endpoint: '', model: '', apiVersion: '2024-10-21' },
  gateway: { endpoint: '', model: '' },
  lmstudio: { endpoint: 'http://localhost:1234', model: '' },
};

/**
 * Display preferences, stored under the settings key 'ui'. `moneyStyle` 'vi' is "55.000 ₫", 'intl' is "₫55,000".
 * `accent` is the app colour as lowercase `#rrggbb` (docs/accent-color-design.md, docs/ui-redesign-design.md).
 * `theme` 'system' follows the OS until the user picks one. `welcomed`: the setup guide has been finished or skipped.
 */
export type Theme = 'system' | 'light' | 'dark';
export type UiSettings = {
  language: Lang;
  moneyStyle: 'vi' | 'intl';
  defaultCurrency: string;
  accent: string;
  checkUpdates: boolean;
  theme: Theme;
  welcomed: boolean;
};
export const DEFAULT_UI: UiSettings = {
  language: 'vi',
  moneyStyle: 'vi',
  defaultCurrency: 'VND',
  accent: '#00709d', // the "ocean" preset (renderer/accent.ts PRESETS[0]; a test keeps them equal)
  checkUpdates: true,
  theme: 'system',
  welcomed: false,
};

export type SettingsView = { llm: LlmSettings; hasKey: Record<Provider, boolean>; openAtLogin: boolean; ui: UiSettings; version: string };
/**
 * `latest` is the newer version to announce (null: none); `url` is the page to open for it; `canInstall` says whether this
 * build can download and install it itself (Windows installer, Linux AppImage) or only send the user to `url`.
 * `manualInstall` is the macOS / Windows portable case: the app downloads the file and opens it, the user finishes the install.
 */
export type UpdateStatus = { current: string; latest: string | null; url: string | null; canInstall: boolean; manualInstall: boolean };
/** `apiKey` is for the active provider. */
export type SettingsInput = { llm: LlmSettings; apiKey?: string };

export type ImageInput = { name: string; bytes: Uint8Array };
/** A PDF already rendered to one JPEG per page by the renderer. */
export type PdfInput = { name: string; pages: ImageInput[] };
export type Page = 'chat' | 'today' | 'tasks' | 'notes' | 'expenses' | 'reminders' | 'settings';

export type Api = {
  conversations: {
    list(): Promise<ConversationRow[]>;
    create(): Promise<number>;
    remove(id: number): Promise<void>;
    rename(id: number, title: string): Promise<void>;
  };
  chat: {
    messages(id: number): Promise<ChatMessage[]>;
    actions(id: number): Promise<PendingAction[]>;
    /** `files`: let the assistant search and read files under ~ for this message only. `document`: a PDF, instead of `images`. */
    send(id: number, text: string, images: ImageInput[], files?: boolean, document?: PdfInput): Promise<void>;
    /** Whether a turn is running, for a chat opened mid-turn. */
    running(id: number): Promise<boolean>;
    stop(id: number): Promise<void>;
    retry(id: number): Promise<void>;
    resolve(actionId: number, decision: 'confirm' | 'cancel', args?: unknown): Promise<void>;
    /** Answers an ask_user card, one reply per question; the turn resumes. */
    answer(actionId: number, replies: AskReply[]): Promise<void>;
    onEvent(cb: (e: AgentEvent) => void): () => void;
  };
  files: {
    /** Shows a ~/… path from a file tool result selected in Explorer/Finder/the file manager; rejects outside ~ or blocked paths. */
    reveal(path: string): Promise<void>;
  };
  data: {
    read<T = unknown>(tool: string, args: object): Promise<T>;
    write(tool: string, args: object): Promise<unknown>;
    /** A create_* / update_* of one record, adding images and removing its attachments `removeIds`; returns the saved row. */
    save(tool: string, args: object, images?: ImageInput[], removeIds?: string[]): Promise<unknown>;
    onChanged(cb: () => void): () => void;
  };
  settings: {
    get(): Promise<SettingsView>;
    save(s: SettingsInput): Promise<void>;
    test(): Promise<string>;
    /** The model ids the saved gateway endpoint lists (GET <endpoint>/models with the saved key). */
    listModels(provider: Provider): Promise<string[]>;
    /** Applies at once (independent of the LLM config); resolves to the state now in effect. */
    setOpenAtLogin(on: boolean): Promise<boolean>;
    /** Validates, saves and broadcasts `ui:changed`; resolves to the settings now in effect. */
    setUi(patch: Partial<UiSettings>): Promise<UiSettings>;
    /** Where the app keeps its data (the database, attachments, backups). */
    dataPath(): Promise<string>;
    /** Opens that folder in Finder / Explorer / the file manager. */
    revealData(): Promise<void>;
  };
  update: {
    /** `manual` (the Settings button) always asks GitHub and throws on failure; automatic is silent and at most daily. */
    check(manual: boolean): Promise<UpdateStatus>;
    /** Stops announcing this version; a newer one is announced again. */
    skip(version: string): Promise<void>;
    /** Downloads the newer version and restarts into it; rejects (installFailed) when it cannot, and never resolves when it can. */
    install(): Promise<void>;
    /** Download progress 0–100 while `install` runs. */
    onProgress(cb: (percent: number) => void): () => void;
  };
  /** `process.platform` of the main process: 'darwin' draws the native traffic lights, so the app's own buttons are hidden. */
  platform: string;
  win: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  /** True when the UI runs in a browser against the Docker server (docs/docker-design.md); false in the Electron window. */
  web: boolean;
  /** Reminders that just came due; only the Docker server emits this (Electron shows a system toast itself). */
  onReminder(cb: (rows: ReminderRow[]) => void): () => void;
  onNavigate(cb: (page: Page) => void): () => void;
  onUiChanged(cb: (ui: UiSettings) => void): () => void;
};
