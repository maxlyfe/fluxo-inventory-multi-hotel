import { Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConversationWithMeta } from '../../lib/chat';
import UnreadBadge from './UnreadBadge';

interface ConversationItemProps {
  conversation: ConversationWithMeta;
  isActive: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

export default function ConversationItem({ conversation, isActive }: ConversationItemProps) {
  const isGroup = conversation.type === 'group';
  const lastMsg = conversation.last_message;

  let preview = '';
  if (lastMsg) {
    if (lastMsg.type === 'image') preview = '📷 Imagem';
    else if (lastMsg.type === 'audio') preview = '🎵 Áudio';
    else preview = lastMsg.content || '';
  }

  return (
    <Link
      to={`/chat/${conversation.id}`}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer border-b border-gray-100 dark:border-gray-700/50 ${
        isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
    >
      {/* Avatar */}
      {conversation.display_avatar ? (
        <img
          src={conversation.display_avatar}
          alt={conversation.display_name}
          className="w-11 h-11 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div
          className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
            isGroup ? 'bg-indigo-500' : 'bg-blue-500'
          }`}
        >
          {isGroup ? <Users className="w-5 h-5" /> : initials(conversation.display_name)}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
            {conversation.display_name}
          </span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">
            {lastMsg ? formatTime(lastMsg.created_at) : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {preview || 'Sem mensagens'}
          </span>
          <UnreadBadge count={conversation.unread_count} />
        </div>
      </div>
    </Link>
  );
}
