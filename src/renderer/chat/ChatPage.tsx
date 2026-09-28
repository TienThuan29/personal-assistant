import { MessageList } from './MessageList';
import { SendBox } from './SendBox';
import { useChat } from './useChat';

export function ChatPage({ conversationId }: { conversationId: number }) {
  const chat = useChat(conversationId);
  return (
    <div className='chat'>
      <MessageList chat={chat} />
      <SendBox running={chat.running} onSend={chat.send} onStop={chat.stop} />
    </div>
  );
}
