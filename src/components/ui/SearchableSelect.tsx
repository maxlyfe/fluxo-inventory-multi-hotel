import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Star } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  starred?: boolean;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  placeholder: string;
  onSelect: (value: string) => void;
  className?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({ options, placeholder, onSelect, className }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const starred = filtered.filter(o => o.starred);
  const rest = filtered.filter(o => !o.starred);

  const inputCls = 'w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors';

  return (
    <div ref={ref} className={`relative w-full ${className || ''}`}>
      <div
        className={inputCls + ' flex items-center gap-2 cursor-pointer'}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
      >
        <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-sm p-0 focus:ring-0"
        />
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">Nenhum resultado</div>
          )}
          {starred.map(o => (
            <button
              key={o.value}
              onClick={() => { onSelect(o.value); setOpen(false); setQuery(''); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-between group"
            >
              <span className="truncate">{o.label}</span>
              <Star className="w-3.5 h-3.5 fill-blue-500" />
            </button>
          ))}
          {rest.map(o => (
            <button
              key={o.value}
              onClick={() => { onSelect(o.value); setOpen(false); setQuery(''); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 truncate"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
