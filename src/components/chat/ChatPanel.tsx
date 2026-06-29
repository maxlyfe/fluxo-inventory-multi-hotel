import { ArrowLeft, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useMessages } from '../../hooks/useChat';
import { ConversationWithMeta } from '../../lib/chat';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';

interface ChatPanelProps {
  conversation: ConversationWithMeta;
  isMobile?: boolean;
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

export default function ChatPanel({ conversation, isMobile }: ChatPanelProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { messages, loading, sendMessage } = useMessages(conversation.id);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGroup = conversation.type === 'group';

  // Auto-scroll ao fundo em novas mensagens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const memberCount = conversation.members?.length || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {isMobile && (
          <button
            onClick={() => navigate('/chat')}
            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        {/* Avatar */}
        {conversation.display_avatar ? (
          <img
            src={conversation.display_avatar}
            alt={conversation.display_name}
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${isGroup ? 'bg-indigo-500' : 'bg-blue-500'}`}>
            {isGroup ? <Users className="w-4 h-4" /> : initials(conversation.display_name)}
          </div>
        )}

        <div className="min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">
            {conversation.display_name}
          </p>
          {isGroup && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {memberCount} participante{memberCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 dark:bg-gray-900 space-y-0.5">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 pt-16">
            <p className="text-sm">Nenhuma mensagem ainda</p>
            <p className="text-xs">Seja o primeiro a escrever!</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isOwn = msg.sender_id === user?.id;
          const prevMsg = messages[idx - 1];
          const showSender = isGroup && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={isOwn}
              showSender={showSender}
              isGroup={isGroup}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput onSend={sendMessage} />
    </div>
  );
}
