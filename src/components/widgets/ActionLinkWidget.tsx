import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ExternalLink } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

export default function ActionLinkWidget({ settings }: { settings?: any }) {
  const navigate = useNavigate();
  
  const label = settings?.label || 'Nova Ação';
  const href = settings?.href || '/';
  const iconName = settings?.icon || 'Link';
  const color = settings?.color || '#3b82f6';
  const sub = settings?.sub || 'Clique para acessar';

  // @ts-ignore
  const Icon = (LucideIcons as any)[iconName] || LucideIcons.Link;

  return (
    <button
      onClick={() => navigate(href)}
      className="group bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 transition-all text-left w-full h-full flex flex-col justify-between"
    >
      <div className="flex items-start justify-between mb-2">
        <div 
          className="p-3 rounded-2xl transition-transform group-hover:scale-110 group-hover:rotate-3"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
        <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>

      <div>
        <h4 className="font-black text-slate-800 dark:text-white text-sm uppercase tracking-tight truncate">{label}</h4>
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1 truncate">{sub}</p>
      </div>
    </button>
  );
}
