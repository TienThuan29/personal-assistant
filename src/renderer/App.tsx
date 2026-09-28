import { AionScrollArea, SiderItem, UiProvider, WindowControls } from '@aionui/ui';
import { Button, ConfigProvider, Message, Modal } from '@arco-design/web-react';
import viVN from '@arco-design/web-react/es/locale/vi-VN';
import { CheckOne, Comment, Delete, Notes, Plus, SettingTwo, Wallet } from '@icon-park/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationRow, Page } from '../shared/types';
import { api, errorText } from './api';
import { ChatPage } from './chat/ChatPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { NotesPage } from './pages/NotesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';

type Route = { page: 'chat'; id: number } | { page: Exclude<Page, 'chat'> };

const NAV = [
  { page: 'tasks', name: 'Task', icon: <CheckOne /> },
  { page: 'notes', name: 'Ghi chú', icon: <Notes /> },
  { page: 'expenses', name: 'Chi tiêu', icon: <Wallet /> },
] as const;

const VI_LABELS = {
  cancel: 'Hủy',
  confirm: 'Xác nhận',
  clear: 'Xóa',
  close: 'Đóng',
  back: 'Quay lại',
  copy: 'Sao chép',
  copySuccess: 'Đã sao chép',
  copyFailed: 'Sao chép thất bại',
  save: 'Lưu',
  loading: 'Đang tải...',
  processing: 'Đang xử lý...',
};

// Arco's vi-VN locale lacks the ColorPicker strings its Locale type requires; the app has no ColorPicker.
const ARCO_LOCALE = { ...viVN, ColorPicker: {} };

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
  const theme = useSystemTheme();
  const [route, setRoute] = useState<Route | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [maximized, setMaximized] = useState(false);
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
    setRoute({ page: 'chat', id });
  }, [refresh]);

  const openLatest = useCallback(async () => {
    const list = await refresh();
    if (list[0]) setRoute({ page: 'chat', id: list[0].id });
    else await newChat();
  }, [refresh, newChat]);

  useEffect(() => {
    openLatest().catch(fail);
    void api.win.isMaximized().then(setMaximized);
    const offs = [
      api.win.onMaximizedChange(setMaximized),
      api.onNavigate((page) => {
        if (page !== 'chat') setRoute({ page });
      }),
      api.chat.onEvent((e) => {
        if (e.type === 'done') void refresh(); // picks up the auto-title
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [openLatest, refresh]);

  const removeConversation = (c: ConversationRow) =>
    modal.confirm?.({
      title: 'Xóa hội thoại?',
      content: c.title,
      okButtonProps: { status: 'danger' },
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

  return (
    <UiProvider theme={theme} locale='vi-VN' labels={VI_LABELS}>
      <ConfigProvider locale={ARCO_LOCALE}>
        {modalHolder}
        {messageHolder}
        <div className='app'>
          <header className='titlebar'>
            <span className='titlebar-title'>Trợ lý cá nhân</span>
            <WindowControls
              isMaximized={maximized}
              onMinimize={() => void api.win.minimize()}
              onToggleMaximize={() => void api.win.toggleMaximize()}
              onClose={() => void api.win.close()}
            />
          </header>
          <div className='app-body'>
            <aside className='sider'>
              <Button type='primary' long icon={<Plus />} onClick={() => void newChat()}>
                Hội thoại mới
              </Button>
              {NAV.map((n) => (
                <SiderItem key={n.page} icon={n.icon} name={n.name} selected={route?.page === n.page} onClick={() => setRoute({ page: n.page })} />
              ))}
              <div className='sider-label'>Hội thoại</div>
              <AionScrollArea className='sider-list'>
                {conversations.map((c) => (
                  <SiderItem
                    key={c.id}
                    icon={<Comment />}
                    name={c.title}
                    selected={route?.page === 'chat' && route.id === c.id}
                    menuItems={[{ key: 'delete', icon: <Delete />, label: 'Xóa', danger: true }]}
                    onMenuAction={() => removeConversation(c)}
                    onClick={() => setRoute({ page: 'chat', id: c.id })}
                  />
                ))}
              </AionScrollArea>
              <SiderItem icon={<SettingTwo />} name='Cài đặt' selected={route?.page === 'settings'} onClick={() => setRoute({ page: 'settings' })} />
            </aside>
            <main className='content'>
              {route?.page === 'chat' && <ChatPage key={route.id} conversationId={route.id} />}
              {route?.page === 'tasks' && <TasksPage />}
              {route?.page === 'notes' && <NotesPage />}
              {route?.page === 'expenses' && <ExpensesPage />}
              {route?.page === 'settings' && <SettingsPage />}
            </main>
          </div>
        </div>
      </ConfigProvider>
    </UiProvider>
  );
}
