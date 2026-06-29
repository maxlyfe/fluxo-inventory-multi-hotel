import { Pencil, Search } from 'lucide-react';
import { useState } from 'react';
import { useConversations } from '../../hooks/useChat';
import ConversationItem from './ConversationItem';
import NewConversationModal from './NewConversationModal';

interface ConversationListProps {
  activeConversationId?: string;
}

export default function ConversationList({ activeConversationId }: ConversationListProps) {
  const { conversations, loading } = useConversations();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const filtered = conversations.filter(c =>
    c.display_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-white text-base">Mensagens</h2>
        <button
          onClick={() => setShowNew(true)}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title="Nova conversa"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>

      {/* Busca */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar conversa..."
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <p className="text-sm">Nenhuma conversa</p>
            <button
              onClick={() => setShowNew(true)}
              className="text-xs text-blue-500 hover:underline"
            >
              Iniciar uma conversa
            </button>
          </div>
        )}

        {filtered.map(conv => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeConversationId}
          />
        ))}
      </div>

      {showNew && <NewConversationModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
