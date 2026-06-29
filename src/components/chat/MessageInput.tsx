import { KeyboardEvent, useRef, useState } from 'react';
import { Send } from 'lucide-react';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex items-end gap-2 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Mensagem..."
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none rounded-2xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-[120px] overflow-y-auto"
      />
      <button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white flex items-center justify-center transition-colors"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}
