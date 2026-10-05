import { Message } from '@arco-design/web-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageInput, Page, PdfInput } from '../../shared/types';
import { api } from '../api';
import { ChatContext } from './ChatContext';
import { MessageList } from './MessageList';
import { SendBox } from './SendBox';
import { useChat } from './useChat';
import { useModelInfo } from './useModelInfo';

/**
 * The conversation, its composer, and (when `contextOpen`) the panel beside it. `initialSend` is a first message sent as the
 * chat opens: what the setup guide's suggestions start.
 */
export function ChatPage({
  conversationId,
  autoFocus,
  initialSend,
  contextOpen,
  go,
}: {
  conversationId: number;
  autoFocus?: boolean;
  initialSend?: string;
  contextOpen: boolean;
  go: (page: Page) => void;
}) {
  const { t } = useTranslation('chat');
  const chat = useChat(conversationId);
  const model = useModelInfo();
  const [message, messageHolder] = Message.useMessage();
  /** The gateway can't see images (design G8): say so when some, or a PDF (which is drawn to images), were sent through it. */
  const send = async (text: string, images: ImageInput[], files: boolean, document?: PdfInput) => {
    const sent = await chat.send(text, images, files, document);
    if (sent && (images.length || document))
      api.settings.get().then((s) => s.llm.active === 'gateway' && message.warning?.(t(document ? 'gatewayNoPdf' : 'gatewayNoImages')), () => {});
    return sent;
  };
  const started = useRef(false);
  useEffect(() => {
    if (initialSend && !started.current) {
      started.current = true;
      void chat.send(initialSend, []);
    }
  }, [initialSend]);

  return (
    <div className='chat'>
      {messageHolder}
      <div className='flex-1 min-w-0 flex flex-col min-h-0'>
        <MessageList chat={chat} />
        <SendBox running={chat.running} onSend={send} onStop={chat.stop} autoFocus={autoFocus} modelLabel={model ? [model.name, model.provider].filter(Boolean).join(' · ') : ''} />
      </div>
      {contextOpen && <ChatContext actions={chat.actions} model={model} go={go} />}
    </div>
  );
}
