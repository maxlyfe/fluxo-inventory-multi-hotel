import React from 'react';
import { X, GripVertical, Settings } from 'lucide-react';

interface WidgetContainerProps {
  children: React.ReactNode;
  label: string;
  isEditing?: boolean;
  isDragging?: boolean;
  dragListeners?: Record<string, any>;
  dragAttributes?: Record<string, any>;
  onRemove?: () => void;
  onSettings?: () => void;
  sizeW?: number;
  onResize?: (sizeW: number) => void;
}

const SIZE_OPTIONS = [
  { w: 3,  label: 'P' },
  { w: 4,  label: 'M' },
  { w: 6,  label: 'G' },
  { w: 12, label: 'F' },
];

export default function WidgetContainer({
  children,
  label,
  isEditing,
  isDragging,
  dragListeners,
  dragAttributes,
  onRemove,
  onSettings,
  sizeW,
  onResize,
}: WidgetContainerProps) {
  return (
    <div className="group relative h-full">
      {/* Redimensionar — modo edição */}
      {isEditing && onResize && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-50 flex gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg p-0.5">
          {SIZE_OPTIONS.map(opt => (
            <button
              key={opt.w}
              onClick={() => onResize(opt.w)}
              className={`w-5 h-5 rounded-full text-[9px] font-black transition-all ${
                sizeW === opt.w
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title={opt.w === 3 ? 'Pequeno' : opt.w === 4 ? 'Médio' : opt.w === 6 ? 'Grande' : 'Largura total'}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {isEditing && (
        <div className="absolute -top-2 -right-2 z-50 flex gap-1">
          {onSettings && (
            <button
              onClick={onSettings}
              className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-400 hover:text-blue-500 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-400 hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drag handle — funcional quando em modo edição */}
      {isEditing && (
        <div
          {...dragListeners}
          {...dragAttributes}
          className="absolute -top-2 -left-2 z-50 p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-400 hover:text-blue-500 cursor-grab active:cursor-grabbing transition-colors touch-none"
          title="Arrastar para reposicionar"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      <div className={`h-full transition-all duration-200 ${
        isDragging
          ? 'opacity-40 scale-[0.97] ring-2 ring-blue-500/50'
          : isEditing
            ? 'ring-2 ring-blue-500/20 scale-[0.98] opacity-90'
            : ''
      }`}>
        {children}
      </div>
    </div>
  );
}
