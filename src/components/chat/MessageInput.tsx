import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Send, Smile, X } from 'lucide-react';
import { Message } from '../../lib/chat';

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: 'Frequentes', emojis: ['😀','😂','😍','🥰','😊','😎','🤣','😅','😘','🙂','😉','😋','🤔','😏','😢','😭','😱','🤗','👍','👏','🙏','❤️','🔥','✅','👋','🎉'] },
  { label: 'Rostos', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱'] },
  { label: 'Gestos', emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏'] },
  { label: 'Objetos', emojis: ['💼','📱','💻','⌨️','📞','📧','📝','📎','📌','📊','📈','🗂️','📁','🗑️','🔑','🔒','🔧','🛠️','⚙️','💡','🔔','📢','💰','💳','🏷️','📦','🧾','🪪'] },
  { label: 'Símbolos', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','✅','❌','⭕','❗','❓','💯','🔥','⭐','🌟','💫','✨','🎯','🏆','🎖️','🥇','🥈','🥉'] },
];

interface MessageInputProps {
  onSend: (content: string, replyToId?: string) => void;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
  onEditSubmit?: (messageId: string, newContent: string) => void;
  replyingTo?: Message | null;
  editingMessage?: Message | null;
  disabled?: boolean;
}

export default function MessageInput({
  onSend,
  onCancelReply,
  onCancelEdit,
  onEditSubmit,
  replyingTo,
  editingMessage,
  disabled,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  // Populate textarea when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.content || '');
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  // Focus textarea when replying
  useEffect(() => {
    if (replyingTo) {
      textareaRef.current?.focus();
    }
  }, [replyingTo]);

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const handleSend = () => {
    const text = value.trim();
    if (!text || disabled) return;

    if (editingMessage && onEditSubmit) {
      onEditSubmit(editingMessage.id, text);
    } else {
      onSend(text, replyingTo?.id);
    }

    setValue('');
    setShowEmoji(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (editingMessage) onCancelEdit?.();
      else if (replyingTo) onCancelReply?.();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const next = value.slice(0, start) + emoji + value.slice(end);
      setValue(next);
      requestAnimationFrame(() => {
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
        el.focus();
      });
    } else {
      setValue(prev => prev + emoji);
    }
  };

  const handleCancelEdit = () => {
    setValue('');
    onCancelEdit?.();
  };

  const handleCancelReply = () => {
    onCancelReply?.();
  };

  const replyName = replyingTo?.sender?.full_name?.trim() || replyingTo?.sender?.email || 'Usuário';

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      {/* Reply preview bar */}
      {replyingTo && !editingMessage && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700">
          <div className="w-1 h-8 bg-blue-500 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{replyName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{replyingTo.content}</p>
          </div>
          <button onClick={handleCancelReply} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit mode bar */}
      {editingMessage && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <div className="w-1 h-8 bg-amber-500 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Editando mensagem</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{editingMessage.content}</p>
          </div>
          <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2 px-4 py-3">
        {showEmoji && (
          <div
            ref={emojiRef}
            className="absolute bottom-full left-2 right-2 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 overflow-hidden"
          >
            <div className="flex gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700 overflow-x-auto scrollbar-hide">
              {EMOJI_CATEGORIES.map((cat, i) => (
                <button
                  key={cat.label}
                  onClick={() => setActiveCategory(i)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeCategory === i
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-8 gap-0.5 p-2 max-h-48 overflow-y-auto">
              {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => insertEmoji(emoji)}
                  className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowEmoji(s => !s)}
          disabled={disabled}
          className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            showEmoji
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          } disabled:opacity-50`}
        >
          <Smile className="w-5 h-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={editingMessage ? 'Editar mensagem...' : 'Mensagem...'}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none rounded-2xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-[120px] overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className={`flex-shrink-0 w-10 h-10 rounded-full text-white flex items-center justify-center transition-colors ${
            editingMessage
              ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-600'
              : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600'
          }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
