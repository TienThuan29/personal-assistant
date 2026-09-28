// Types shared by main, preload and renderer. No runtime code except constants.

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

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type UserMessage = { role: 'user'; content: string; attachment_ids?: string[] };
export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
export type ToolMessage = { role: 'tool'; tool_call_id: string; content: string };
export type StoredMessage = UserMessage | AssistantMessage | ToolMessage;
export type ChatMessage = StoredMessage & { id: number; created_at: string };

export type PendingAction = {
  id: number;
  conversation_id: number;
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  preview: unknown;
  status: 'pending' | 'confirmed' | 'cancelled';
  result: unknown;
};

export type AgentEvent = { conversationId: number } & (
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'saved' }
  | { type: 'pending' }
  | { type: 'done' }
  | { type: 'error'; message: string }
);

export type LlmConfig = { provider: 'azure' | 'gateway'; endpoint: string; model: string; apiVersion: string };
export const DEFAULT_LLM: LlmConfig = { provider: 'gateway', endpoint: '', model: '', apiVersion: '2024-10-21' };

export type SettingsView = { llm: LlmConfig; hasKey: Record<LlmConfig['provider'], boolean>; openAtLogin: boolean };
export type SettingsInput = { llm: LlmConfig; apiKey?: string; openAtLogin: boolean };

export type ImageInput = { name: string; bytes: Uint8Array };
export type Page = 'chat' | 'tasks' | 'notes' | 'expenses' | 'settings';

export type Api = {
  conversations: {
    list(): Promise<ConversationRow[]>;
    create(): Promise<number>;
    remove(id: number): Promise<void>;
  };
  chat: {
    messages(id: number): Promise<ChatMessage[]>;
    actions(id: number): Promise<PendingAction[]>;
    send(id: number, text: string, images: ImageInput[]): Promise<void>;
    stop(id: number): Promise<void>;
    retry(id: number): Promise<void>;
    resolve(actionId: number, decision: 'confirm' | 'cancel', args?: unknown): Promise<void>;
    onEvent(cb: (e: AgentEvent) => void): () => void;
  };
  data: {
    read<T = unknown>(tool: string, args: object): Promise<T>;
    write(tool: string, args: object): Promise<unknown>;
    onChanged(cb: () => void): () => void;
  };
  settings: {
    get(): Promise<SettingsView>;
    save(s: SettingsInput): Promise<void>;
    test(): Promise<string>;
  };
  win: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  onNavigate(cb: (page: Page) => void): () => void;
};
