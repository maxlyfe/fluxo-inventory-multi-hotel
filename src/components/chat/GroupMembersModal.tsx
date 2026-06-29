import { UserPlus, UserMinus, X, Crown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import {
  ChatProfile,
  ConversationWithMeta,
  addMembersToConversation,
  getGroupUsers,
  removeMemberFromConversation,
} from '../../lib/chat';

interface GroupMembersModalProps {
  conversation: ConversationWithMeta;
  onClose: () => void;
  onChanged: () => void;
}

function initials(p: ChatProfile) {
  const name = p.full_name?.trim() || p.email || '?';
  return name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

function displayName(p: ChatProfile) {
  return p.full_name?.trim() || p.email || 'Usuário';
}

export default function GroupMembersModal({ conversation, onClose, onChanged }: GroupMembersModalProps) {
  const { user } = useAuth();
  const { addNotification } = useNotification();
  const [allUsers, setAllUsers] = useState<ChatProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<'members' | 'add'>('members');

  const memberIds = new Set(conversation.members.map(m => m.user_id));
  const isCreator = conversation.created_by === user?.id;

  useEffect(() => {
    getGroupUsers().then(data => { setAllUsers(data); setLoading(false); });
  }, []);

  const handleRemove = async (userId: string) => {
    setSaving(userId);
    try {
      await removeMemberFromConversation(conversation.id, userId);
      onChanged();
      addNotification('success', 'Participante removido.');
    } catch {
      addNotification('error', 'Não foi possível remover o participante.');
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async (userId: string) => {
    setSaving(userId);
    try {
      await addMembersToConversation(conversation.id, [userId]);
      onChanged();
      addNotification('success', 'Participante adicionado.');
    } catch {
      addNotification('error', 'Não foi possível adicionar o participante.');
    } finally {
      setSaving(null);
    }
  };

  const currentMembers = conversation.members.map(m => ({
    ...m.profile,
    id: m.user_id,
    isCreator: m.user_id === conversation.created_by,
  }));

  const nonMembers = allUsers.filter(u => !memberIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-semibold text-gray-900 dark:text-white">Participantes</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={() => setTab('members')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'members' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            No grupo ({conversation.members.length})
          </button>
          <button
            onClick={() => setTab('add')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'add' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            Adicionar
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Lista de membros atuais */}
          {!loading && tab === 'members' && currentMembers.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700">
              <div className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {initials(m as ChatProfile)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{displayName(m as ChatProfile)}</p>
                {m.isCreator && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                    <Crown className="w-3 h-3" /> Criador
                  </p>
                )}
              </div>
              {/* Pode remover: criador remove qualquer um, ou usuário sai sozinho */}
              {(isCreator || m.id === user?.id) && !m.isCreator && (
                <button
                  onClick={() => handleRemove(m.id!)}
                  disabled={saving === m.id}
                  className="p-1.5 rounded-full text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-colors disabled:opacity-50"
                  title={m.id === user?.id ? 'Sair do grupo' : 'Remover participante'}
                >
                  {saving === m.id
                    ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    : <UserMinus className="w-4 h-4" />}
                </button>
              )}
            </div>
          ))}

          {/* Adicionar não-membros */}
          {!loading && tab === 'add' && nonMembers.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">Todos os usuários já estão no grupo</p>
          )}

          {!loading && tab === 'add' && nonMembers.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700">
              <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {initials(u)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{displayName(u)}</p>
              </div>
              <button
                onClick={() => handleAdd(u.id)}
                disabled={saving === u.id}
                className="p-1.5 rounded-full text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 transition-colors disabled:opacity-50"
                title="Adicionar ao grupo"
              >
                {saving === u.id
                  ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  : <UserPlus className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
