import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ImageInput } from '../../shared/types';
import { api } from '../api';
import { MessageList } from './MessageList';
import { SendBox } from './SendBox';
import { useChat } from './useChat';

export function ChatPage({ conversationId }: { conversationId: number }) {
  const { t } = useTranslation('chat');
  const chat = useChat(conversationId);
  const [message, messageHolder] = Message.useMessage();
  /** The gateway can't see images (design G8): say so when some were sent through it. */
  const send = async (text: string, images: ImageInput[]) => {
    const sent = await chat.send(text, images);
    if (sent && images.length)
      api.settings.get().then((s) => s.llm.active === 'gateway' && message.warning?.(t('gatewayNoImages')), () => {});
    return sent;
  };
  return (
    <div className='chat'>
      {messageHolder}
      <MessageList chat={chat} />
      <SendBox running={chat.running} onSend={send} onStop={chat.stop} />
    </div>
  );
}
