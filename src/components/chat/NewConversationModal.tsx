import { X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGroupConversation, getOrCreateDirectConversation } from '../../lib/chat';
import ContactPickerModal from './ContactPickerModal';

interface NewConversationModalProps {
  onClose: () => void;
}

type Tab = 'direct' | 'group';

export default function NewConversationModal({ onClose }: NewConversationModalProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('direct');
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDirectConfirm = async (ids: string[]) => {
    if (!ids[0]) return;
    setLoading(true);
    const convId = await getOrCreateDirectConversation(ids[0]);
    setLoading(false);
    if (convId) {
      onClose();
      navigate(`/chat/${convId}`);
    }
  };

  const handleGroupCreate = async () => {
    if (!groupName.trim() || selectedIds.length < 1) return;
    setLoading(true);
    const conv = await createGroupConversation(groupName.trim(), selectedIds);
    setLoading(false);
    if (conv) {
      onClose();
      navigate(`/chat/${conv.id}`);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Nova conversa</h3>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {(['direct', 'group'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {t === 'direct' ? 'Mensagem Direta' : 'Grupo'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'direct' ? (
              <button
                onClick={() => setShowPicker(true)}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                Selecionar contato
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Nome do grupo</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder="Ex: Equipe Recepção"
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={() => setShowPicker(true)}
                  className="w-full py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {selectedIds.length > 0
                    ? `${selectedIds.length} participante(s) selecionado(s)`
                    : 'Adicionar participantes'}
                </button>
                <button
                  onClick={handleGroupCreate}
                  disabled={!groupName.trim() || selectedIds.length < 1 || loading}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-semibold transition-colors"
                >
                  {loading ? 'Criando...' : 'Criar Grupo'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPicker && (
        <ContactPickerModal
          multiSelect={tab === 'group'}
          selected={selectedIds}
          onToggle={id => setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
          )}
          onClose={() => setShowPicker(false)}
          onConfirm={ids => {
            setShowPicker(false);
            if (tab === 'direct') {
              handleDirectConfirm(ids);
            } else {
              setSelectedIds(ids);
            }
          }}
          confirmLabel={tab === 'group' ? 'Adicionar ao grupo' : 'Confirmar'}
        />
      )}
    </>
  );
}
