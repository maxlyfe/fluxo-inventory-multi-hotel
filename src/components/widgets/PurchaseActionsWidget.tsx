import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Package, ArrowRight, Plus } from 'lucide-react';

export default function PurchaseActionsWidget() {
  const navigate = useNavigate();

  const actions = [
    { 
      label: 'Nova Requisição', 
      sub: 'Pedir itens ao estoque',
      href: '/shopping-list', 
      icon: Package, 
      color: '#3b82f6' 
    },
    { 
      label: 'Novo Pedido de Compra', 
      sub: 'Gerar cotação externa',
      href: '/purchases/list', 
      icon: ShoppingCart, 
      color: '#f59e0b' 
    },
  ];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <ShoppingCart className="w-5 h-5 text-blue-500" />
        </div>
        <h3 className="font-bold text-slate-800 dark:text-white">Ações de Compras</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 flex-1">
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => navigate(action.href)}
            className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700/50 hover:border-blue-300 dark:hover:border-blue-700 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
              style={{ backgroundColor: `${action.color}15` }}>
              <action.icon className="w-5 h-5" style={{ color: action.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{action.label}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{action.sub}</p>
            </div>
            <Plus className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
