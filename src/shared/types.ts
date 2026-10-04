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
/** `files`: the user turned on file search for this message (docs/file-search-design.md). */
export type UserMessage = { role: 'user'; content: string; attachment_ids?: string[]; files?: true };
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

export type AgentEvent = { conversationId: number } & (
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'saved' }
  | { type: 'pending' }
  | { type: 'done' }
  | { type: 'error'; message: string }
);

export type Provider = 'azure' | 'gateway';
/** One provider's connection, resolved from LlmSettings for createLlm. A gateway's apiVersion is ''. */
export type LlmConfig = { provider: Provider; endpoint: string; model: string; apiVersion: string };
/** Stored under the settings key 'llm': one config per provider, so switching never overwrites the other (design G1). */
export type LlmSettings = {
  active: Provider;
  azure: { endpoint: string; model: string; apiVersion: string };
  gateway: { endpoint: string; model: string };
};
/** Product names, the same in every language. */
export const PROVIDER_NAMES: Record<Provider, string> = { azure: 'Azure AI Foundry', gateway: 'LLM gateway' };
export const DEFAULT_LLM: LlmSettings = {
  active: 'gateway',
  azure: { endpoint: '', model: '', apiVersion: '2024-10-21' },
  gateway: { endpoint: '', model: '' },
};

/**
 * Display preferences, stored under the settings key 'ui'. `moneyStyle` 'vi' is "55.000 ₫", 'intl' is "₫55,000".
 * `accent` is the app colour as lowercase `#rrggbb` (docs/accent-color-design.md).
 */
export type UiSettings = { language: Lang; moneyStyle: 'vi' | 'intl'; defaultCurrency: string; accent: string; checkUpdates: boolean };
export const DEFAULT_UI: UiSettings = { language: 'vi', moneyStyle: 'vi', defaultCurrency: 'VND', accent: '#ab502d', checkUpdates: true };

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
    /** `files`: let the assistant search and read files under ~ for this message only. */
    send(id: number, text: string, images: ImageInput[], files?: boolean): Promise<void>;
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
  win: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  onNavigate(cb: (page: Page) => void): () => void;
  onUiChanged(cb: (ui: UiSettings) => void): () => void;
};
