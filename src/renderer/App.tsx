import { UiProvider } from '@aionui/ui';
import { ConfigProvider, Message, Modal } from '@arco-design/web-react';
import enUS from '@arco-design/web-react/es/locale/en-US';
import viVN from '@arco-design/web-react/es/locale/vi-VN';
import { Minus, PanelLeft, PanelRight, Square, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ConversationRow, DEFAULT_CONVERSATION_TITLE, type ExpenseRow, type NoteRow, type Page, type ReminderRow, type TaskRow, type UpdateStatus } from '../shared/types';
import { api, errorText, useUiSettings } from './api';
import { ChatPage } from './chat/ChatPage';
import { CaptureDialog } from './components/capture';
import { Palette, type PaletteActions } from './components/Palette';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { UpdateBanner } from './components/UpdateBanner';
import { confirmDanger, ICON, Kbd } from './components/ui';
import { Welcome } from './components/Welcome';
import { ExpenseForm } from './pages/ExpenseForm';
import { ExpensesPage } from './pages/ExpensesPage';
import { NoteForm } from './pages/NoteForm';
import { NotesPage } from './pages/NotesPage';
import { ReminderForm } from './pages/ReminderForm';
import { RemindersPage } from './pages/RemindersPage';
import { SettingsPage } from './pages/SettingsPage';
import { TaskForm } from './pages/TaskForm';
import { TasksPage } from './pages/TasksPage';
import { TodayPage } from './pages/TodayPage';
import { hasMod, shortcutLabel } from './shortcuts';

type Route =
  | { page: 'chat'; id: number; focus?: boolean; send?: string }
  | { page: 'tasks'; edit?: TaskRow }
  | { page: 'notes'; noteId?: number }
  | { page: Exclude<Page, 'chat' | 'tasks' | 'notes'> };

/** The pages Cmd/Ctrl+1…5 reach, in that order. */
const PAGE_KEYS = ['today', 'tasks', 'notes', 'expenses', 'reminders'] as const;

const SIDER_KEY = 'pa.siderCollapsed';
const CTX_KEY = 'pa.chatContext';

const flag = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const remember = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {}
};

const modalOpen = () => [...document.querySelectorAll('.arco-modal-wrapper')].some((el) => getComputedStyle(el).display !== 'none');

// Arco's vi-VN locale lacks the ColorPicker strings its Locale type requires; the settings picker shows none of them.
const ARCO_LOCALES = { vi: { ...viVN, ColorPicker: {} }, en: enUS };

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** The theme in effect: main sets Electron's theme source from the Light/Dark/System choice, so the media query is the truth. */
function useResolvedTheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, []);
  const theme = dark ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.setAttribute('arco-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);
  return theme;
}

type Form = { kind: 'task'; row: TaskRow | null } | { kind: 'expense'; row: ExpenseRow | null } | { kind: 'reminder'; row: ReminderRow | null } | { kind: 'note'; row: NoteRow | null };

export function App() {
  const { t, i18n } = useTranslation(['common', 'chat', 'shell']);
  const ui = useUiSettings();
  const lang = i18n.language === 'en' ? 'en' : 'vi';
  const theme = useResolvedTheme();
  /** The DB default title is Vietnamese; show it in the current language. User-set and auto titles stay as they are. */
  const titleOf = useCallback((c: ConversationRow) => (c.title === DEFAULT_CONVERSATION_TITLE ? t('chat:newChat') : c.title), [t]);
  useEffect(() => {
    document.title = t('appName');
  }, [t]);
  const [route, setRoute] = useState<Route | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const mac = api.platform === 'darwin'; // native traffic lights instead of our own window buttons
  const [maximized, setMaximized] = useState(false);
  const [percent, setPercent] = useState<number | null>(null); // download progress while the app updates itself
  const [update, setUpdate] = useState<UpdateStatus | null>(null); // a newer version, when there is one (docs/update-design.md)
  const [collapsed, setCollapsed] = useState(() => flag(SIDER_KEY, false));
  const [ctxOpen, setCtxOpen] = useState(() => flag(CTX_KEY, true));
  const [palette, setPalette] = useState(false);
  const [capture, setCapture] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modal, modalHolder] = Modal.useModal();
  const [message, messageHolder] = Message.useMessage();
  const fail = (e: unknown) => message.error?.(errorText(e));
  const routeRef = useRef(route); // read after an await: a nav may have arrived meanwhile
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  useEffect(() => remember(SIDER_KEY, collapsed), [collapsed]);
  useEffect(() => remember(CTX_KEY, ctxOpen), [ctxOpen]);

  const refresh = useCallback(async () => {
    const list = await api.conversations.list();
    setConversations(list);
    return list;
  }, []);

  /** A new conversation; `send` is a first message the chat sends as soon as it opens (the setup guide's suggestions). */
  const newChat = useCallback(
    async (send?: string) => {
      const id = await api.conversations.create();
      await refresh();
      setRoute({ page: 'chat', id, focus: true, send });
    },
    [refresh]
  );

  const openLatest = useCallback(
    async (focus?: boolean) => {
      const list = await refresh();
      if (list[0]) setRoute({ page: 'chat', id: list[0].id, focus });
      else await newChat();
    },
    [refresh, newChat]
  );

  /** Opens a page; 'chat' opens the latest conversation with the composer focused. */
  const go = useCallback(
    async (page: Page) => {
      if (page === 'chat') await openLatest(true);
      else setRoute({ page });
    },
    [openLatest]
  );

  /** Whether a model is set up, and whether this is a first run that should start with the setup guide. */
  const checkSetup = useCallback(async (first = false) => {
    try {
      const s = await api.settings.get();
      const ready = s.llm.active === 'lmstudio' || s.hasKey[s.llm.active];
      setModelReady(ready);
      if (first && !s.ui.welcomed && !ready) setWelcome(true);
    } catch {}
  }, []);

  useEffect(() => {
    openLatest().catch(fail);
    void checkSetup(true);
    void api.win.isMaximized().then(setMaximized);
    api.update.check(false).then(setUpdate, () => {}); // automatic checks never report failure
    const offs = [
      api.win.onMaximizedChange(setMaximized),
      api.onNavigate((page) => go(page).catch(fail)),
      api.update.onProgress(setPercent),
      api.chat.onEvent((e) => {
        if (e.type === 'done') void refresh(); // picks up the auto-title
      }),
    ];
    const onFocus = () => void checkSetup();
    window.addEventListener('focus', onFocus);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('focus', onFocus);
    };
  }, [openLatest, go, refresh, checkSetup]);

  const closeWelcome = () => {
    setWelcome(false);
    void api.settings.setUi({ welcomed: true }).catch(() => {});
    void checkSetup();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e, mac) || e.altKey || e.shiftKey || e.repeat) return; // holding the shortcut for a new chat must not make a chat per repeat
      const key = e.key.toLowerCase();
      const nav = e.code.startsWith('Digit') ? PAGE_KEYS[Number(e.code.slice(5)) - 1] : undefined; // the physical key, so AZERTY works too
      const action =
        key === 'k' ? () => (setCapture(false), setPalette((o) => !o))
        : key === 'j' ? () => (setPalette(false), setCapture((o) => !o))
        : key === 'n' ? () => newChat().catch(fail)
        : nav ? () => setRoute({ page: nav })
        : key === ',' ? () => setRoute({ page: 'settings' })
        : key === 'b' ? () => setCollapsed((c) => !c)
        : null;
      if (!action || modalOpen()) return; // modalOpen() reads styles: only for our keys, not every Ctrl+C
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, mac]);

  const renameConversation = async (id: number, title: string) => {
    await api.conversations.rename(id, title);
    await refresh();
  };

  const removeConversation = (c: ConversationRow) =>
    confirmDanger(modal, {
      title: t('chat:deleteConversation'),
      content: titleOf(c),
      okText: t('delete'),
      onOk: async () => {
        try {
          await api.conversations.remove(c.id);
          const r = routeRef.current;
          if (r?.page === 'chat' && r.id === c.id) await openLatest();
          else await refresh();
        } catch (e) {
          fail(e);
        }
      },
    });

  const paletteActions: PaletteActions = {
    go: (page) => void go(page).catch(fail),
    newChat: () => void newChat().catch(fail),
    capture: () => setCapture(true),
    add: (kind) => setForm({ kind, row: null } as Form),
    openTask: (task) => setRoute({ page: 'tasks', edit: task }),
    openNote: (noteId) => setRoute({ page: 'notes', noteId }),
    openChat: (id) => setRoute({ page: 'chat', id }),
    toggleTheme: () => void api.settings.setUi({ theme: theme === 'dark' ? 'light' : 'dark' }).catch(fail),
    toggleLanguage: () => void api.settings.setUi({ language: lang === 'en' ? 'vi' : 'en' }).catch(fail),
    welcome: () => setWelcome(true),
  };

  const conversation = route?.page === 'chat' ? conversations.find((c) => c.id === route.id) : undefined;
  const title = route?.page === 'chat' ? (conversation ? titleOf(conversation) : '') : route ? t(`nav.${route.page}`) : '';
  const siderLabel = t(collapsed ? 'expandSidebar' : 'collapseSidebar');

  return (
    <UiProvider theme={theme} locale={lang === 'en' ? 'en-US' : 'vi-VN'} labels={t('ui', { returnObjects: true })}>
      <ConfigProvider locale={ARCO_LOCALES[lang]}>
        <ToastProvider>
          {modalHolder}
          {messageHolder}
          <div className='relative flex h-full min-w-[720px] overflow-hidden bg-chrome text-ink'>
            <Sidebar
              collapsed={collapsed}
              mac={mac}
              page={route?.page}
              modelReady={modelReady}
              conversations={conversations}
              selectedId={route?.page === 'chat' ? route.id : undefined}
              titleOf={titleOf}
              onSearch={() => setPalette(true)}
              onNewChat={() => newChat().catch(fail)}
              onGo={(page) => go(page).catch(fail)}
              onOpenChat={(id) => setRoute({ page: 'chat', id })}
              onRename={renameConversation}
              onDelete={removeConversation}
            />
            <div className='flex-1 min-w-0 flex flex-col'>
              <header className='drag h-12 shrink-0 flex items-center gap-2 pr-2'>
                <button
                  type='button'
                  aria-label={siderLabel}
                  title={`${siderLabel} (${shortcutLabel('B', mac)})`}
                  onClick={() => setCollapsed((c) => !c)}
                  className='grid place-items-center w-8 h-8 border-0 rounded-lg bg-transparent text-ink-2 text-base cursor-pointer hover:bg-hover hover:text-ink'
                >
                  <PanelLeft {...ICON} />
                </button>
                <h1 className='flex-1 min-w-0 m-0 text-[13px] font-600 truncate'>{title}</h1>
                <button
                  type='button'
                  onClick={() => setCapture(true)}
                  className='h-[30px] flex items-center gap-[7px] px-2.5 rounded-lg border border-solid border-line bg-panel text-ink text-[12.5px] font-500 shadow-sm cursor-pointer hover:border-accent-line'
                >
                  <span aria-hidden className='flex text-sm text-accent'>
                    <Zap {...ICON} />
                  </span>
                  <span className='whitespace-nowrap'>{t('shell:capture')}</span>
                  <Kbd>{shortcutLabel('J', mac)}</Kbd>
                </button>
                {route?.page === 'chat' && (
                  <button
                    type='button'
                    aria-label={t('shell:context')}
                    aria-pressed={ctxOpen}
                    title={t('shell:context')}
                    onClick={() => setCtxOpen((o) => !o)}
                    className={`grid place-items-center w-8 h-8 border-0 rounded-lg text-base cursor-pointer hover:text-ink ${ctxOpen ? 'bg-hover text-ink' : 'bg-transparent text-ink-2 hover:bg-hover'}`}
                  >
                    <PanelRight {...ICON} />
                  </button>
                )}
                {!mac && (
                  <div className='flex -mt-2 -mr-2 ml-1.5 self-start'>
                    <button type='button' aria-label={t('shell:minimize')} onClick={() => void api.win.minimize()} className='grid place-items-center w-[46px] h-[34px] border-0 bg-transparent text-ink-2 text-[15px] cursor-pointer hover:bg-hover'>
                      <Minus {...ICON} />
                    </button>
                    <button type='button' aria-label={t(maximized ? 'shell:restore' : 'shell:maximize')} onClick={() => void api.win.toggleMaximize()} className='grid place-items-center w-[46px] h-[34px] border-0 bg-transparent text-ink-2 text-xs cursor-pointer hover:bg-hover'>
                      <Square {...ICON} />
                    </button>
                    <button type='button' aria-label={t('shell:close')} onClick={() => void api.win.close()} className='grid place-items-center w-[46px] h-[34px] border-0 bg-transparent text-ink-2 text-base cursor-pointer hover:bg-[#E81123] hover:text-white'>
                      <X {...ICON} />
                    </button>
                  </div>
                )}
              </header>
              {update?.latest && (
                <UpdateBanner
                  update={update}
                  percent={percent}
                  onInstall={() => {
                    setPercent(0);
                    api.update.install().catch((e) => {
                      fail(e);
                      setPercent(null);
                      setUpdate({ ...update, canInstall: false }); // fall back to the download page
                    });
                  }}
                  onSkip={() =>
                    api.update
                      .skip(update.latest!)
                      .then(() => setUpdate(null))
                      .catch(fail)
                  }
                />
              )}
              <main className='content flex-1 min-h-0 mr-2 mb-2 flex relative bg-panel border border-solid border-line rounded-xl shadow-sm overflow-hidden'>
                {route?.page === 'chat' && (
                  <ChatPage key={route.id} conversationId={route.id} autoFocus={route.focus} initialSend={route.send} contextOpen={ctxOpen} go={(p) => go(p).catch(fail)} />
                )}
                {route?.page === 'today' && <TodayPage go={(p) => go(p).catch(fail)} />}
                {route?.page === 'tasks' && <TasksPage key={route.edit?.id ?? 'list'} initialEdit={route.edit} />}
                {route?.page === 'notes' && <NotesPage key={route.noteId ?? 'list'} initialNoteId={route.noteId} />}
                {route?.page === 'expenses' && <ExpensesPage />}
                {route?.page === 'reminders' && <RemindersPage />}
                {route?.page === 'settings' && <SettingsPage onWelcome={() => setWelcome(true)} />}
              </main>
            </div>
            {palette && <Palette actions={paletteActions} conversations={conversations} titleOf={titleOf} dark={theme === 'dark'} mac={mac} onClose={() => setPalette(false)} />}
            {capture && <CaptureDialog onClose={() => setCapture(false)} />}
            {welcome && <Welcome onClose={closeWelcome} onTry={(prompt) => void newChat(prompt).catch(fail)} />}
          </div>
          {form?.kind === 'task' && <TaskForm task={form.row} categories={[]} onClose={() => setForm(null)} />}
          {form?.kind === 'expense' && <ExpenseForm expense={form.row} categories={[]} onClose={() => setForm(null)} />}
          {form?.kind === 'reminder' && <ReminderForm reminder={form.row} onClose={() => setForm(null)} />}
          {form?.kind === 'note' && <NoteForm note={form.row} onClose={() => setForm(null)} />}
        </ToastProvider>
      </ConfigProvider>
    </UiProvider>
  );
}
