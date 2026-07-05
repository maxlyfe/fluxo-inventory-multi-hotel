import { useEffect, useRef, useState } from 'react';
import { Check, Copy, CornerUpLeft, History, Pencil, Trash2 } from 'lucide-react';
import { Message, MessageEdit, getMessageEditHistory } from '../../lib/chat';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  isGroup: boolean;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function senderName(message: Message) {
  if (!message.sender) return 'Usuário';
  return message.sender.full_name?.trim() || message.sender.email || 'Usuário';
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

export default function MessageBubble({ message, isOwn, showSender, isGroup, onReply, onEdit, onDelete }: MessageBubbleProps) {
  const name = senderName(message);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editHistory, setEditHistory] = useState<MessageEdit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Long press for mobile
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setMenuPos({ x: touch.clientX, y: touch.clientY });
      setShowMenu(true);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setShowMenu(false);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleViewHistory = async () => {
    setShowMenu(false);
    setHistoryLoading(true);
    setShowHistory(true);
    const history = await getMessageEditHistory(message.id);
    setEditHistory(history);
    setHistoryLoading(false);
  };

  const replyTo = message.reply_to;
  const replyName = replyTo?.sender?.full_name?.trim() || replyTo?.sender?.email || 'Usuário';

  return (
    <div
      ref={bubbleRef}
      className={`flex gap-2 mb-1 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
    >
      {/* Avatar (só para mensagens de outros em grupo) */}
      {!isOwn && isGroup && (
        <div className="flex-shrink-0 self-end">
          {message.sender?.photo_url ? (
            <img src={message.sender.photo_url} alt={name} className="w-7 h-7 rounded-full object-cover" />
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
          className={`relative px-3 py-2 rounded-2xl text-sm break-words ${
            isOwn
              ? 'bg-blue-600 text-white rounded-br-sm'
              : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm rounded-bl-sm'
          }`}
        >
          {/* Reply preview */}
          {replyTo && (
            <div className={`mb-1.5 px-2 py-1.5 rounded-lg border-l-2 text-xs ${
              isOwn
                ? 'bg-blue-500/30 border-blue-300'
                : 'bg-gray-100 dark:bg-gray-600 border-indigo-400'
            }`}>
              <p className={`font-semibold text-[10px] ${isOwn ? 'text-blue-200' : 'text-indigo-500 dark:text-indigo-300'}`}>
                {replyName}
              </p>
              <p className={`truncate ${isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-300'}`}>
                {replyTo.content || '📎 Mídia'}
              </p>
            </div>
          )}

          {message.content}

          {/* Edited indicator */}
          {message.edited_at && (
            <button
              onClick={handleViewHistory}
              className={`inline-flex items-center gap-0.5 ml-1.5 text-[10px] italic ${
                isOwn ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              editado
            </button>
          )}
        </div>

        <div className={`flex items-center gap-1 mt-0.5 ${isOwn ? 'mr-1 flex-row-reverse' : 'ml-1'}`}>
          <span className="text-[10px] text-gray-400">{formatTime(message.created_at)}</span>
          {copied && <span className="text-[10px] text-green-500 font-medium">copiado!</span>}
        </div>
      </div>

      {/* Context menu */}
      {showMenu && menuPos && (
        <div
          ref={menuRef}
          className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl py-1.5 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: Math.min(menuPos.x, window.innerWidth - 180),
            top: Math.min(menuPos.y, window.innerHeight - 250),
          }}
        >
          <MenuButton icon={<CornerUpLeft className="w-4 h-4" />} label="Responder" onClick={() => { setShowMenu(false); onReply?.(message); }} />
          <MenuButton icon={<Copy className="w-4 h-4" />} label="Copiar" onClick={handleCopy} />
          {isOwn && (
            <>
              <MenuButton icon={<Pencil className="w-4 h-4" />} label="Editar" onClick={() => { setShowMenu(false); onEdit?.(message); }} />
              {message.edited_at && (
                <MenuButton icon={<History className="w-4 h-4" />} label="Histórico" onClick={handleViewHistory} />
              )}
              <div className="mx-2 my-1 border-t border-gray-100 dark:border-gray-700" />
              <MenuButton
                icon={<Trash2 className="w-4 h-4" />}
                label="Apagar"
                danger
                onClick={() => { setShowMenu(false); onDelete?.(message.id); }}
              />
            </>
          )}
        </div>
      )}

      {/* Edit history modal */}
      {showHistory && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setShowHistory(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[60vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-sm text-gray-800 dark:text-white">Histórico de edições</h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>
            <div className="overflow-y-auto max-h-[50vh] p-3 space-y-2">
              {/* Current version */}
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-1.5 mb-1">
                  <Check className="w-3 h-3 text-blue-500" />
                  <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">Versão atual</span>
                </div>
                <p className="text-sm text-gray-800 dark:text-gray-200">{message.content}</p>
              </div>

              {historyLoading ? (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : editHistory.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-2">Sem versões anteriores</p>
              ) : (
                editHistory.map(edit => (
                  <div key={edit.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                    <span className="text-[10px] text-gray-400">{formatDateTime(edit.edited_at)}</span>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{edit.old_content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
