// src/pages/Home.tsx
import React, { useState, useEffect, useMemo, Suspense, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Plus, Settings2, Save, Trash2,
  Layout, Sparkles, Loader2, Search,
  Package, ChevronRight, Boxes,
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { supabase } from '../lib/supabase';

import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useHotel } from '../context/HotelContext';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { AVAILABLE_WIDGETS, WidgetSize } from '../config/widgetsConfig';
import { NAV_GROUPS } from '../lib/navigationConfig';
import WidgetContainer from '../components/widgets/WidgetContainer';
import { sectorIcon } from '../utils/sectorIcon';

const Home = () => {
  const { user } = useAuth();
  const { can, isAdmin, isDev } = usePermissions();
  const { selectedHotel } = useHotel();
  const { widgets, loading, addWidget, removeWidget } = useDashboardConfig();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [searchTerm, setSearchTarget] = useState('');
  const [allHotelSectors, setAllHotelSectors] = useState<any[]>([]);

  useEffect(() => {
    if (!selectedHotel) navigate('/select-hotel', { replace: true });
  }, [selectedHotel, navigate]);

  useEffect(() => {
    if (selectedHotel?.id) {
      supabase.from('sectors').select('id, name, color').eq('hotel_id', selectedHotel.id).order('name')
        .then(({ data }) => setAllHotelSectors(data || []));
    }
  }, [selectedHotel?.id]);

  const possibleTargets = useMemo(() => {
    const targets: any[] = [];
    NAV_GROUPS.forEach(group => {
      group.items.forEach(item => {
        if (can(item.module) || (item.module === '__contacts__' && isAdmin)) {
          targets.push({
            id: `page-${item.href}`,
            label: item.label,
            sub: group.label,
            href: item.href,
            icon: item.icon,
            iconName: item.iconName,
            color: item.color
          });
        }
      });
    });
    allHotelSectors.forEach(sector => {
      const { icon, iconName } = sectorIcon(sector.name);
      targets.push({
        id: `sector-${sector.id}`,
        label: sector.name,
        sub: 'Requisição Direta',
        href: `/sector/${sector.id}`,
        icon,
        iconName,
        color: sector.color || '#6366f1'
      });
    });

    // Stock setorial — só aparece se o utilizador tem permissão (ou é admin/dev)
    allHotelSectors.forEach(sector => {
      if (isAdmin || isDev || can(`sector_stock:${sector.id}`)) {
        const { icon, iconName } = sectorIcon(sector.name);
        targets.push({
          id: `stock-sector-${sector.id}`,
          label: sector.name,
          sub: 'Stock Setorial',
          href: `/sector-stock/${sector.id}`,
          icon,
          iconName,
          color: sector.color || '#8b5cf6'
        });
      }
    });

    return targets;
  }, [allHotelSectors, can, isAdmin, isDev]);

  const filteredTargets = possibleTargets.filter(t => 
    t.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.sub.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const standardWidgets = AVAILABLE_WIDGETS.filter(w => w.type === 'standard' && (!w.module || can(w.module)));

  if (!selectedHotel || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const handleAddAction = (target: any, size: WidgetSize = 'small') => {
    addWidget('action-link', {
      label: target.label,
      href: target.href,
      icon: target.iconName || 'Link',
      color: target.color,
      sub: target.sub,
    }, size === 'small' ? 3 : size === 'medium' ? 4 : 6);
    setShowMarketplace(false);
  };

  const getGridSpan = (sizeW: number) => {
    if (sizeW === 12) return 'col-span-12';
    if (sizeW === 6)  return 'col-span-12 lg:col-span-6';
    if (sizeW === 4)  return 'col-span-12 sm:col-span-6 lg:col-span-4';
    return 'col-span-12 sm:col-span-6 lg:col-span-3';
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950 pb-20">
      <div className="sticky top-0 z-30 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Layout className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight">Centro de Comando</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{selectedHotel.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:border-blue-500 transition-all active:scale-95 shadow-sm">
                <Settings2 className="w-3.5 h-3.5" /> Personalizar
              </button>
            ) : (
              <>
                <button onClick={() => setShowMarketplace(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 transition-all active:scale-95 shadow-lg">
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
                <button onClick={() => setIsEditing(false)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-all active:scale-95 shadow-lg">
                  <Save className="w-3.5 h-3.5" /> Concluir
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-12 gap-6">
          {widgets.map((userWidget) => {
            const definition = AVAILABLE_WIDGETS.find(w => w.id === userWidget.widget_id);
            if (!definition) return null;
            const WidgetComponent = definition.component;
            // Helper para gerar classes literais (Tailwind safe)
            const getGridSpan = (sizeW: number) => {
              if (sizeW === 12) return 'col-span-12';
              if (sizeW === 6)  return 'col-span-12 lg:col-span-6';
              if (sizeW === 4)  return 'col-span-12 sm:col-span-6 lg:col-span-4';
              return 'col-span-12 sm:col-span-6 lg:col-span-3';
            };
            const spanClass = getGridSpan(userWidget.size_w);

            return (
              <div key={userWidget.id} className={spanClass}>
                <WidgetContainer label={definition.label} isEditing={isEditing} onRemove={() => removeWidget(userWidget.id)}>
                  <Suspense fallback={<div className="h-40 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse" />}>
                    <WidgetComponent settings={userWidget.settings} />
                  </Suspense>
                </WidgetContainer>
              </div>
            );
          })}
          {widgets.length === 0 && !loading && (
            <div className="col-span-12 py-20 flex flex-col items-center justify-center text-center">
              <Sparkles className="w-12 h-12 text-slate-300 mb-4" />
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">Dashboard Vazio</h2>
              <button onClick={() => { setIsEditing(true); setShowMarketplace(true); }} className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-xl font-bold">Começar Montagem</button>
            </div>
          )}
        </div>
      </main>

      <Transition show={showMarketplace} as={Fragment}>
        <Dialog as="div" className="relative z-[100]" onClose={() => setShowMarketplace(false)}>
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm" />
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Dialog.Panel className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-800 p-8">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Adicionar ao Dashboard</h3>
                    <p className="text-sm text-slate-400 mt-1">Crie atalhos diretos ou adicione widgets de dados.</p>
                  </div>
                  <button onClick={() => setShowMarketplace(false)} className="p-3 bg-slate-100 dark:bg-slate-800 rounded-full hover:text-red-500 transition-all">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-2">Módulos de Dados</h4>
                    <div className="space-y-2">
                      {standardWidgets.map(w => (
                        <button key={w.id} onClick={() => { addWidget(w.id); setShowMarketplace(false); }} className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-indigo-900/10 border border-slate-100 dark:border-slate-700 transition-all text-left">
                          <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl shadow-sm"><w.icon className="w-5 h-5 text-indigo-500" /></div>
                          <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-white">{w.label}</p>
                            <p className="text-[10px] text-slate-400">{w.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Atalhos de Acesso Rápido</h4>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input type="text" placeholder="Buscar destino..." value={searchTerm} onChange={e => setSearchTarget(e.target.value)} className="pl-8 pr-4 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none w-48" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin">
                      {filteredTargets.map(target => (
                        <div key={target.id} className="group p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: `${target.color}15` }}>
                              <target.icon className="w-5 h-5" style={{ color: target.color }} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-black text-slate-800 dark:text-white uppercase truncate">{target.label}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{target.sub}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handleAddAction(target, 'small')} className="flex-1 py-1.5 bg-white dark:bg-slate-700 hover:bg-blue-500 hover:text-white text-[9px] font-black uppercase rounded-lg border border-slate-200 dark:border-slate-600 transition-all">Pequeno</button>
                            <button onClick={() => handleAddAction(target, 'medium')} className="flex-1 py-1.5 bg-white dark:bg-slate-700 hover:bg-blue-500 hover:text-white text-[9px] font-black uppercase rounded-lg border border-slate-200 dark:border-slate-600 transition-all">Médio</button>
                            <button onClick={() => handleAddAction(target, 'large')} className="flex-1 py-1.5 bg-white dark:bg-slate-700 hover:bg-blue-500 hover:text-white text-[9px] font-black uppercase rounded-lg border border-slate-200 dark:border-slate-600 transition-all">Grande</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};

export default Home;
