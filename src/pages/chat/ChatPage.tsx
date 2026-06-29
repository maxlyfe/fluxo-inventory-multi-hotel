import { MessageSquare } from 'lucide-react';
import { useParams } from 'react-router-dom';
import ChatPanel from '../../components/chat/ChatPanel';
import ConversationList from '../../components/chat/ConversationList';
import { useConversations } from '../../hooks/useChat';

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { conversations, markConversationRead } = useConversations();

  const activeConversation = conversations.find(c => c.id === conversationId) || null;

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* Lista de conversas — oculta no mobile quando há conversa ativa */}
      <div
        className={`${
          conversationId ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-96 flex-shrink-0 flex-col`}
      >
        <ConversationList activeConversationId={conversationId} />
      </div>

      {/* Painel de chat */}
      <div
        className={`${
          conversationId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col overflow-hidden`}
      >
        {activeConversation ? (
          <ChatPanel
            conversation={activeConversation}
            isMobile={!!conversationId}
            onRead={markConversationRead}
          />
        ) : (
          /* Placeholder no desktop quando nenhuma conversa está aberta */
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 bg-gray-50 dark:bg-gray-900">
            <MessageSquare className="w-12 h-12 opacity-30" />
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        )}
      </div>
    </div>
  );
}
