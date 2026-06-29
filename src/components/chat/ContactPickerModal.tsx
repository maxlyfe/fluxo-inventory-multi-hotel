import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatProfile, getGroupUsers } from '../../lib/chat';

interface ContactPickerModalProps {
  multiSelect?: boolean;
  selected: string[];
  onToggle: (userId: string) => void;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  confirmLabel?: string;
}

function initials(p: ChatProfile) {
  const name = p.full_name?.trim() || p.email || '?';
  return name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

function displayName(p: ChatProfile) {
  return p.full_name?.trim() || p.email || 'Usuário';
}

export default function ContactPickerModal({
  multiSelect = true,
  selected,
  onToggle,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmar',
}: ContactPickerModalProps) {
  const [contacts, setContacts] = useState<ChatProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGroupUsers().then(data => { setContacts(data); setLoading(false); });
  }, []);

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return (
      c.full_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">Selecionar contato</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto max-h-72">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">Nenhum contato encontrado</p>
          )}

          {filtered.map(c => {
            const isSelected = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => {
                  if (!multiSelect) {
                    onConfirm([c.id]);
                    return;
                  }
                  onToggle(c.id);
                }}
                className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                {c.photo_url ? (
                  <img src={c.photo_url} alt={displayName(c)} className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
                    {initials(c)}
                  </div>
                )}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{displayName(c)}</p>
                  {c.full_name && <p className="text-xs text-gray-400 truncate">{c.email}</p>}
                </div>
                {multiSelect && (
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-500'
                  }`}>
                    {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {multiSelect && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => onConfirm(selected)}
              disabled={selected.length === 0}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-semibold transition-colors"
            >
              {confirmLabel} {selected.length > 0 ? `(${selected.length})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
