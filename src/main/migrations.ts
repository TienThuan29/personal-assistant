// Append-only. Each entry runs once, in a transaction, and bumps PRAGMA user_version.
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    category TEXT NOT NULL DEFAULT 'personal',
    priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
    due_date TEXT,
    due_time TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'cancelled')),
    recurrence TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    completed_at TEXT
  );
  CREATE INDEX idx_tasks_due ON tasks (status, due_date);

  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY,
    task_id INTEGER REFERENCES tasks (id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'dismissed'))
  );
  CREATE INDEX idx_reminders_at ON reminders (status, remind_at);
  CREATE INDEX idx_reminders_task ON reminders (task_id);

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'journal')),
    title TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  );
  CREATE VIRTUAL TABLE notes_fts USING fts5 (
    title, body, content = 'notes', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  END;
  CREATE TRIGGER notes_au AFTER UPDATE OF title, body ON notes BEGIN
    INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'VND',
    category TEXT NOT NULL,
    description TEXT,
    spent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  );
  CREATE INDEX idx_expenses_at ON expenses (spent_at);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('task', 'note', 'expense', 'message')),
    owner_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  );
  CREATE INDEX idx_attachments_owner ON attachments (owner_type, owner_id);

  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Hội thoại mới',
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  );
  CREATE INDEX idx_messages_conv ON messages (conversation_id, id);

  CREATE TABLE pending_actions (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    preview TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    result TEXT
  );
  CREATE INDEX idx_pending_conv ON pending_actions (conversation_id, status);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];
