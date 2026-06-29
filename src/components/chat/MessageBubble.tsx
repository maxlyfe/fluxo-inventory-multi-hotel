import { Message } from '../../lib/chat';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  isGroup: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function senderName(message: Message) {
  if (!message.sender) return 'Usuário';
  return message.sender.full_name?.trim() || message.sender.email || 'Usuário';
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();
}

export default function MessageBubble({ message, isOwn, showSender, isGroup }: MessageBubbleProps) {
  const name = senderName(message);

  return (
    <div className={`flex gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar (só para mensagens de outros em grupo) */}
      {!isOwn && isGroup && (
        <div className="flex-shrink-0 self-end">
          {message.sender?.photo_url ? (
            <img
              src={message.sender.photo_url}
              alt={name}
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold">
              {initials(name)}
            </div>
          )}
        </div>
      )}

      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Nome do remetente em grupos */}
        {!isOwn && isGroup && showSender && (
          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mb-0.5 ml-1">
            {name}
          </span>
        )}

        <div
          className={`px-3 py-2 rounded-2xl text-sm break-words ${
            isOwn
              ? 'bg-blue-600 text-white rounded-br-sm'
              : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm rounded-bl-sm'
          }`}
        >
          {message.content}
        </div>

        <span className={`text-[10px] text-gray-400 mt-0.5 ${isOwn ? 'mr-1' : 'ml-1'}`}>
          {formatTime(message.created_at)}
        </span>
      </div>
    </div>
  );
}
