// src/pages/diretoria/DirectorPanel.tsx
// Painel do Diretor — visão consolidada do GRUPO em uma única tela.
// Independe da unidade selecionada; o hotel selecionado só altera a ORDEM:
// o card do hotel atual vem primeiro, depois os demais do grupo.
//
// Fase 1: KPIs de inventário + vagas RH por unidade (dados reais) e acesso
// direto (com edição) às telas existentes — Escala, Colaboradores, Benefícios,
// Transferências, Café/MAP/FAP, Rack de UH e Manutenção — por unidade.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import { useFormatters } from '../../hooks/useFormatters';
import {
  LayoutDashboard, Package, AlertTriangle, DollarSign, Briefcase,
  CalendarDays, Users, Gift, ArrowLeftRight, Coffee, Hotel as HotelIcon,
  Wrench, Loader2, ChevronRight, Building2,
} from 'lucide-react';

interface HotelRow { id: string; name: string; code?: string | null; [k: string]: any; }
interface HotelAgg { items: number; lowStock: number; invested: number; openJobs: number; }

const EMPTY_AGG: HotelAgg = { items: 0, lowStock: 0, invested: 0, openJobs: 0 };

export default function DirectorPanel() {
  const navigate = useNavigate();
  const { selectedHotel, setSelectedHotel } = useHotel();
  const { currentGroup } = useGroup();
  const { formatCurrency } = useFormatters();

  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [agg, setAgg]       = useState<Record<string, HotelAgg>>({});
  const [loading, setLoading] = useState(true);

  // ── Carrega hotéis do grupo + agrega inventário e vagas ────────────────────
  useEffect(() => {
    if (!currentGroup?.id) { setHotels([]); setLoading(false); return; }
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data: hotelRows } = await supabase
          .from('hotels')
          .select('*')
          .eq('group_id', currentGroup.id)
          .eq('is_active', true)
          .order('name');
        if (!active) return;
        const list = (hotelRows || []) as HotelRow[];
        setHotels(list);

        const ids = list.map(h => h.id);
        if (ids.length === 0) { setAgg({}); setLoading(false); return; }

        // Produtos (inventário central) e vagas — uma query cada, agregadas no cliente.
        const [{ data: products }, { data: jobs }] = await Promise.all([
          supabase.from('products')
            .select('hotel_id, quantity, min_quantity, average_price, last_purchase_price')
            .in('hotel_id', ids),
          supabase.from('job_openings')
            .select('hotel_id, status')
            .in('hotel_id', ids),
        ]);
        if (!active) return;

        const map: Record<string, HotelAgg> = {};
        ids.forEach(id => { map[id] = { ...EMPTY_AGG }; });

        (products || []).forEach((p: any) => {
          const a = map[p.hotel_id]; if (!a) return;
          const qty = Number(p.quantity) || 0;
          const min = Number(p.min_quantity) || 0;
          const price = Number(p.average_price) || Number(p.last_purchase_price) || 0;
          a.items += 1;
          if (min > 0 && qty <= min) a.lowStock += 1;
          a.invested += qty * price;
        });
        (jobs || []).forEach((j: any) => {
          const a = map[j.hotel_id]; if (!a) return;
          if (j.status === 'open') a.openJobs += 1;
        });

        setAgg(map);
      } catch {
        if (active) setAgg({});
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [currentGroup?.id]);

  // Ordena: hotel selecionado primeiro, depois o restante (por nome).
  const orderedHotels = useMemo(() => {
    if (!selectedHotel?.id) return hotels;
    const sel = hotels.filter(h => h.id === selectedHotel.id);
    const rest = hotels.filter(h => h.id !== selectedHotel.id);
    return [...sel, ...rest];
  }, [hotels, selectedHotel?.id]);

  // Totais do grupo
  const groupTotals = useMemo(() => {
    return Object.values(agg).reduce<HotelAgg>((acc, a) => ({
      items: acc.items + a.items,
      lowStock: acc.lowStock + a.lowStock,
      invested: acc.invested + a.invested,
      openJobs: acc.openJobs + a.openJobs,
    }), { ...EMPTY_AGG });
  }, [agg]);

  // Abre uma tela existente NO contexto do hotel do card (define o hotel e navega).
  const go = (hotel: HotelRow, path: string) => {
    setSelectedHotel(hotel as any);
    navigate(path);
  };

  if (!currentGroup) {
    return (
      <div className="container mx-auto p-6 text-center text-gray-500 dark:text-gray-400">
        Selecione um grupo para visualizar o painel.
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <LayoutDashboard className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white leading-tight">Painel do Diretor</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Visão consolidada · {currentGroup.name}</p>
        </div>
      </div>

      {/* Totais do grupo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <GroupKpi icon={<Package className="w-4 h-4" />} label="Itens (grupo)" value={loading ? '—' : groupTotals.items.toLocaleString('pt-BR')} color="indigo" />
        <GroupKpi icon={<AlertTriangle className="w-4 h-4" />} label="Estoque baixo" value={loading ? '—' : groupTotals.lowStock.toLocaleString('pt-BR')} color="amber" />
        <GroupKpi icon={<DollarSign className="w-4 h-4" />} label="Valor investido" value={loading ? '—' : formatCurrency(groupTotals.invested)} color="emerald" />
        <GroupKpi icon={<Briefcase className="w-4 h-4" />} label="Vagas abertas" value={loading ? '—' : groupTotals.openJobs.toLocaleString('pt-BR')} color="sky" />
      </div>

      {/* Cards por unidade (selecionada primeiro) */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : orderedHotels.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma unidade ativa no grupo.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {orderedHotels.map(hotel => {
            const a = agg[hotel.id] || EMPTY_AGG;
            const isCurrent = hotel.id === selectedHotel?.id;
            return (
              <div key={hotel.id}
                className={`rounded-3xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden ${
                  isCurrent ? 'border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-200 dark:ring-indigo-800/50' : 'border-gray-100 dark:border-gray-700'
                }`}>
                {/* Cabeçalho do card */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700/60">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <HotelIcon className="w-5 h-5 text-gray-500 dark:text-gray-300" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{hotel.name}</h2>
                      {hotel.code && <p className="text-[11px] text-gray-400 uppercase tracking-wider">{hotel.code}</p>}
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                      Unidade atual
                    </span>
                  )}
                </div>

                {/* KPIs da unidade */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4">
                  <UnitKpi label="Itens" value={a.items.toLocaleString('pt-BR')} tone="text-gray-800 dark:text-white" />
                  <UnitKpi label="Estoque baixo" value={a.lowStock.toLocaleString('pt-BR')} tone={a.lowStock > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-white'} />
                  <UnitKpi label="Valor investido" value={formatCurrency(a.invested)} tone="text-emerald-600 dark:text-emerald-400" />
                  <UnitKpi label="Vagas abertas" value={a.openJobs.toLocaleString('pt-BR')} tone={a.openJobs > 0 ? 'text-sky-600 dark:text-sky-400' : 'text-gray-800 dark:text-white'} />
                </div>

                {/* Acessos diretos (no contexto desta unidade) */}
                <div className="flex flex-wrap gap-2 px-5 pb-5">
                  <Access label="Escala"        icon={<CalendarDays className="w-3.5 h-3.5" />} onClick={() => go(hotel, '/personnel-department?tab=schedule')} />
                  <Access label="Colaboradores" icon={<Users className="w-3.5 h-3.5" />}        onClick={() => go(hotel, '/personnel-department?tab=employees')} />
                  <Access label="Benefícios"    icon={<Gift className="w-3.5 h-3.5" />}         onClick={() => go(hotel, '/personnel-department?tab=benefits')} />
                  <Access label="Inventário"    icon={<Package className="w-3.5 h-3.5" />}      onClick={() => go(hotel, '/inventory')} />
                  <Access label="Transferências" icon={<ArrowLeftRight className="w-3.5 h-3.5" />} onClick={() => go(hotel, '/inventory/transfers')} />
                  <Access label="Café/MAP/FAP"  icon={<Coffee className="w-3.5 h-3.5" />}       onClick={() => go(hotel, '/breakfast/hall')} />
                  <Access label="Rack de UH"    icon={<HotelIcon className="w-3.5 h-3.5" />}    onClick={() => go(hotel, '/reception/rack')} />
                  <Access label="Manutenção"    icon={<Wrench className="w-3.5 h-3.5" />}       onClick={() => go(hotel, '/maintenance')} />
                  <Access label="Vagas RH"      icon={<Briefcase className="w-3.5 h-3.5" />}    onClick={() => go(hotel, '/rh/jobs')} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  indigo:  'bg-indigo-50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400',
  amber:   'bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400',
  sky:     'bg-sky-50 dark:bg-sky-900/10 text-sky-600 dark:text-sky-400',
};

function GroupKpi({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2 ${COLOR_MAP[color]}`}>{icon}</div>
      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">{label}</p>
      <p className="text-xl font-black text-gray-800 dark:text-white mt-0.5 truncate">{value}</p>
    </div>
  );
}

function UnitKpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3 text-center">
      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-0.5">{label}</p>
      <p className={`text-base font-black truncate ${tone}`}>{value}</p>
    </div>
  );
}

function Access({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
      {icon}{label}<ChevronRight className="w-3 h-3 opacity-50" />
    </button>
  );
}
