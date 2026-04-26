import React from 'react';
import { X, GripVertical, Settings } from 'lucide-react';

interface WidgetContainerProps {
  children: React.ReactNode;
  label: string;
  isEditing?: boolean;
  onRemove?: () => void;
  onSettings?: () => void;
}

export default function WidgetContainer({ 
  children, 
  label, 
  isEditing, 
  onRemove, 
  onSettings 
}: WidgetContainerProps) {
  return (
    <div className="group relative h-full">
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
      
      {isEditing && (
        <div className="absolute -top-2 -left-2 z-50 p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-300 cursor-move">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      <div className={`h-full transition-all duration-300 ${isEditing ? 'ring-2 ring-blue-500/30 scale-[0.98] opacity-80' : ''}`}>
        {children}
      </div>
    </div>
  );
}
