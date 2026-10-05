import { UiProvider, WindowControls } from '@aionui/ui';
import { Alert, Button, ConfigProvider, Message, Modal, Space, Tooltip } from '@arco-design/web-react';
import enUS from '@arco-design/web-react/es/locale/en-US';
import viVN from '@arco-design/web-react/es/locale/vi-VN';
import { CheckOne, MenuFold, MenuUnfold, Notes, Plus, Remind, SettingTwo, Sun, Wallet } from '@icon-park/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ConversationRow, DEFAULT_CONVERSATION_TITLE, type Page, type UpdateStatus } from '../shared/types';
import { api, errorText } from './api';
import { ChatPage } from './chat/ChatPage';
import { ConversationList } from './components/ConversationList';
import { Nav } from './components/Nav';
import { confirmDanger } from './components/ui';
import { ExpensesPage } from './pages/ExpensesPage';
import { NotesPage } from './pages/NotesPage';
import { RemindersPage } from './pages/RemindersPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';
import { TodayPage } from './pages/TodayPage';
import { hasMod, shortcutLabel } from './shortcuts';

type Route = { page: 'chat'; id: number; focus?: boolean } | { page: Exclude<Page, 'chat'> };

/** In Ctrl+1…5 order. */
const NAV = [
  { page: 'today', icon: <Sun /> },
  { page: 'tasks', icon: <CheckOne /> },
  { page: 'notes', icon: <Notes /> },
  { page: 'expenses', icon: <Wallet /> },
  { page: 'reminders', icon: <Remind /> },
] as const;

const SIDER_KEY = 'pa.siderCollapsed';

const modalOpen = () => [...document.querySelectorAll('.arco-modal-wrapper')].some((el) => getComputedStyle(el).display !== 'none');

// Arco's vi-VN locale lacks the ColorPicker strings its Locale type requires; the settings picker shows none of them.
const ARCO_LOCALES = { vi: { ...viVN, ColorPicker: {} }, en: enUS };

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Follows the OS theme and sets the attributes @aionui/ui and Arco key off. */
function useSystemTheme(): 'light' | 'dark' {
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
  }, [theme]);
  return theme;
}

export function App() {
  const { t, i18n } = useTranslation(['common', 'chat']);
  const lang = i18n.language === 'en' ? 'en' : 'vi';
  const theme = useSystemTheme();
  /** The DB default title is Vietnamese; show it in the current language. User-set and auto titles stay as they are. */
  const titleOf = (c: ConversationRow) => (c.title === DEFAULT_CONVERSATION_TITLE ? t('chat:newChat') : c.title);
  useEffect(() => {
    document.title = t('appName');
  }, [t]);
  const [route, setRoute] = useState<Route | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const mac = api.platform === 'darwin'; // native traffic lights instead of WindowControls
  const [maximized, setMaximized] = useState(false);
  const [percent, setPercent] = useState<number | null>(null); // download progress while the app updates itself
  const [update, setUpdate] = useState<UpdateStatus | null>(null); // a newer version, when there is one (docs/update-design.md)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDER_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDER_KEY, collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);
  const [modal, modalHolder] = Modal.useModal();
  const [message, messageHolder] = Message.useMessage();
  const fail = (e: unknown) => message.error?.(errorText(e));
  const routeRef = useRef(route); // read after an await: a nav may have arrived meanwhile
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const refresh = useCallback(async () => {
    const list = await api.conversations.list();
    setConversations(list);
    return list;
  }, []);

  const newChat = useCallback(async () => {
    const id = await api.conversations.create();
    await refresh();
    setRoute({ page: 'chat', id, focus: true });
  }, [refresh]);

  const openLatest = useCallback(
    async (focus?: boolean) => {
      const list = await refresh();
      if (list[0]) setRoute({ page: 'chat', id: list[0].id, focus });
      else await newChat();
    },
    [refresh, newChat],
  );

  /** Opens a page; 'chat' opens the latest conversation with the composer focused. */
  const go = useCallback(
    async (page: Page) => {
      if (page === 'chat') await openLatest(true);
      else setRoute({ page });
    },
    [openLatest],
  );

  useEffect(() => {
    openLatest().catch(fail);
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
    return () => offs.forEach((off) => off());
  }, [openLatest, go, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e, mac) || e.altKey || e.shiftKey || e.repeat) return; // holding the shortcut for a new chat must not make a chat per repeat
      const key = e.key.toLowerCase();
      const nav = e.code.startsWith('Digit') ? NAV[Number(e.code.slice(5)) - 1] : undefined; // the physical key, so AZERTY works too
      const action =
        key === 'n' ? () => newChat().catch(fail)
        : nav ? () => setRoute({ page: nav.page })
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

  const conversation = route?.page === 'chat' ? conversations.find((c) => c.id === route.id) : undefined;
  const title = route?.page === 'chat' ? (conversation ? titleOf(conversation) : '') : route ? t(`nav.${route.page}`) : '';
  const newChatButton = (
    <button
      type='button'
      aria-label={collapsed ? t('chat:newChat') : undefined}
      onClick={() => newChat().catch(fail)}
      className={`flex items-center gap-2 h-9 px-3 mb-2 rounded-ctl border-0 bg-accent-soft text-ink text-sm font-500 cursor-pointer ${collapsed ? 'justify-center' : ''}`}
    >
      {/* Accent icon, ink text: accent text on this tint is under AA (like the active nav item). */}
      <Plus className='flex text-base text-accent' />
      {!collapsed && (
        <>
          <span className='flex-1 text-left truncate'>{t('chat:newChat')}</span>
          <kbd aria-hidden className='text-[11px] font-400 [font-family:inherit]'>{shortcutLabel('N', mac)}</kbd>
        </>
      )}
    </button>
  );
  const siderLabel = t(collapsed ? 'expandSidebar' : 'collapseSidebar');

  return (
    <UiProvider theme={theme} locale={lang === 'en' ? 'en-US' : 'vi-VN'} labels={t('ui', { returnObjects: true })}>
      <ConfigProvider locale={ARCO_LOCALES[lang]}>
        {modalHolder}
        {messageHolder}
        <div className='flex h-full bg-canvas text-ink'>
          <aside className={`sider box-border flex flex-col shrink-0 bg-sunken border-r border-r-solid border-line ${collapsed ? 'w-16' : 'w-60'}`}>
            {mac && <div className='drag h-7 shrink-0' />} {/* room for the traffic lights, which are wider than the collapsed sider */}
            <div className='drag h-11 shrink-0 flex items-center gap-2 px-3'>
              {!collapsed && <span className='flex-1 min-w-0 truncate font-600'>{t('appName')}</span>}
              <Tooltip position='right' content={`${siderLabel} (${shortcutLabel('B', mac)})`}>
                <button
                  type='button'
                  aria-label={siderLabel}
                  onClick={() => setCollapsed((c) => !c)}
                  className='flex items-center justify-center w-10 h-8 rounded-ctl border-0 bg-transparent text-ink-2 text-base cursor-pointer hover:bg-[var(--hover)] hover:text-ink'
                >
                  {collapsed ? <MenuUnfold /> : <MenuFold />}
                </button>
              </Tooltip>
            </div>
            <div className='flex-1 min-h-0 flex flex-col gap-1 px-3 pb-3'>
              {collapsed ? (
                <Tooltip position='right' content={`${t('chat:newChat')} (${shortcutLabel('N', mac)})`}>
                  {newChatButton}
                </Tooltip>
              ) : (
                newChatButton
              )}
              <Nav
                label={t('mainNav')}
                items={NAV.map((n, i) => ({ key: n.page, icon: n.icon, label: t(`nav.${n.page}`), shortcut: shortcutLabel(String(i + 1), mac) }))}
                selected={route?.page}
                collapsed={collapsed}
                onSelect={(k) => go(k as Page).catch(fail)}
              />
              {collapsed ? (
                <div className='flex-1' />
              ) : (
                <ConversationList
                  conversations={conversations}
                  selectedId={route?.page === 'chat' ? route.id : undefined}
                  titleOf={titleOf}
                  onOpen={(id) => setRoute({ page: 'chat', id })}
                  onRename={renameConversation}
                  onDelete={removeConversation}
                />
              )}
              <Nav
                label={t('nav.settings')}
                items={[{ key: 'settings', icon: <SettingTwo />, label: t('nav.settings'), shortcut: shortcutLabel(',', mac) }]}
                selected={route?.page}
                collapsed={collapsed}
                onSelect={() => setRoute({ page: 'settings' })}
              />
            </div>
          </aside>
          <div className='flex-1 min-w-0 flex flex-col'>
            <header className='drag h-11 shrink-0 flex items-center justify-between gap-4 pl-6'>
              <h1 className='m-0 text-[15px] font-600 truncate'>{title}</h1>
              {!mac && (
                <WindowControls
                  isMaximized={maximized}
                  onMinimize={() => void api.win.minimize()}
                  onToggleMaximize={() => void api.win.toggleMaximize()}
                  onClose={() => void api.win.close()}
                />
              )}
            </header>
            {update?.latest && (
              <div className='px-6 pb-2'>
                <Alert
                  type='info'
                  content={t('update.banner', { latest: update.latest, current: update.current })}
                  action={
                    <Space>
                      {update.canInstall ? (
                        <Button
                          size='mini'
                          type='primary'
                          loading={percent !== null}
                          onClick={() => {
                            setPercent(0);
                            api.update.install().catch((e) => {
                              fail(e);
                              setPercent(null);
                              setUpdate({ ...update, canInstall: false }); // fall back to the download page
                            });
                          }}
                        >
                          {percent === null ? t(update.manualInstall ? 'update.installManual' : 'update.install') : t('update.downloading', { percent })}
                        </Button>
                      ) : (
                        <Button size='mini' type='primary' onClick={() => window.open(update.url ?? undefined)}>
                          {t('update.download')}
                        </Button>
                      )}
                      <Button
                        size='mini'
                        disabled={percent !== null}
                        onClick={() =>
                          api.update
                            .skip(update.latest!)
                            .then(() => setUpdate(null))
                            .catch(fail)
                        }
                      >
                        {t('update.skip')}
                      </Button>
                    </Space>
                  }
                />
              </div>
            )}
            <main className='content'>
              {route?.page === 'chat' && <ChatPage key={route.id} conversationId={route.id} autoFocus={route.focus} />}
              {route?.page === 'today' && <TodayPage go={(p) => go(p).catch(fail)} />}
              {route?.page === 'tasks' && <TasksPage />}
              {route?.page === 'notes' && <NotesPage />}
              {route?.page === 'expenses' && <ExpensesPage />}
              {route?.page === 'reminders' && <RemindersPage />}
              {route?.page === 'settings' && <SettingsPage />}
            </main>
          </div>
        </div>
      </ConfigProvider>
    </UiProvider>
  );
}
