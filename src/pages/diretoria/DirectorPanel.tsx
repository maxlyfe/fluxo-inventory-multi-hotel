// src/pages/diretoria/DirectorPanel.tsx
// Painel do Diretor — visão consolidada do GRUPO em uma única tela.
// Independe da unidade selecionada; o hotel selecionado só altera a ORDEM:
// o card do hotel atual vem primeiro, depois os demais do grupo.
//
// Ao clicar num botão, a informação é RENDERIZADA inline (expansível) no card.
// Seções com dado agregado (Inventário, Vagas RH, Colaboradores) mostram os
// dados ali mesmo; telas operacionais (Escala, Rack, Manutenção, etc.) abrem
// em tela cheia no contexto da unidade.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import { useFormatters } from '../../hooks/useFormatters';
import {
  LayoutDashboard, Package, AlertTriangle, DollarSign, Briefcase,
  CalendarDays, Users, Gift, ArrowLeftRight, Coffee, Hotel as HotelIcon,
  Wrench, Loader2, Building2, ExternalLink, ChevronDown,
} from 'lucide-react';

interface HotelRow { id: string; name: string; code?: string | null; [k: string]: any; }
interface CategoryAgg { name: string; items: number; value: number; }
interface HotelData {
  items: number;
  lowStock: number;
  invested: number;
  openJobs: number;
  employeesCount: number;
  categories: CategoryAgg[];
  openJobsList: { title: string; sector: string }[];
  employeesBySector: { sector: string; count: number }[];
}

const EMPTY: HotelData = {
  items: 0, lowStock: 0, invested: 0, openJobs: 0, employeesCount: 0,
  categories: [], openJobsList: [], employeesBySector: [],
};

export default function DirectorPanel() {
  const navigate = useNavigate();
  const { selectedHotel, setSelectedHotel } = useHotel();
  const { currentGroup } = useGroup();
  const { formatCurrency } = useFormatters();

  const [hotels, setHotels]   = useState<HotelRow[]>([]);
  const [data, setData]       = useState<Record<string, HotelData>>({});
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null); // `${hotelId}:${section}`

  useEffect(() => {
    if (!currentGroup?.id) { setHotels([]); setLoading(false); return; }
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data: hotelRows } = await supabase
          .from('hotels').select('*')
          .eq('group_id', currentGroup.id).eq('is_active', true).order('name');
        if (!active) return;
        const list = (hotelRows || []) as HotelRow[];
        setHotels(list);
        if (list.length === 0) { setData({}); setLoading(false); return; }

        // Uma rodada de queries POR HOTEL (evita o teto de 1000 linhas do .in()).
        const entries = await Promise.all(list.map(async (h) => {
          const [{ data: products }, { data: jobs }, { data: emps }] = await Promise.all([
            supabase.from('products')
              .select('quantity, min_quantity, average_price, is_active, category')
              .eq('hotel_id', h.id),
            supabase.from('job_openings')
              .select('title, sector, status').eq('hotel_id', h.id),
            supabase.from('employees')
              .select('sector, is_active').eq('hotel_id', h.id),
          ]);

          const prods = products || [];
          // Mesma fórmula da tela /inventory:
          //  itens = TODOS · estoque baixo = ativo && qty<=min · valor = ativos × preço médio
          const items = prods.length;
          let lowStock = 0, invested = 0;
          const catMap = new Map<string, CategoryAgg>();
          prods.forEach((p: any) => {
            const qty = Number(p.quantity) || 0;
            const min = Number(p.min_quantity) || 0;
            const avg = Number(p.average_price) || 0;
            const isActive = p.is_active !== false;
            if (isActive && qty <= min) lowStock += 1;
            const val = isActive ? avg * qty : 0;
            if (isActive) invested += val;
            const cat = p.category || 'Sem categoria';
            const c = catMap.get(cat) || { name: cat, items: 0, value: 0 };
            c.items += 1; c.value += val;
            catMap.set(cat, c);
          });
          const categories = [...catMap.values()].sort((a, b) => b.value - a.value);

          const openJobsList = (jobs || []).filter((j: any) => j.status === 'open')
            .map((j: any) => ({ title: j.title, sector: j.sector }));

          const activeEmps = (emps || []).filter((e: any) => e.is_active !== false);
          const empMap = new Map<string, number>();
          activeEmps.forEach((e: any) => {
            const s = e.sector || 'Sem setor';
            empMap.set(s, (empMap.get(s) || 0) + 1);
          });
          const employeesBySector = [...empMap.entries()]
            .map(([sector, count]) => ({ sector, count }))
            .sort((a, b) => b.count - a.count);

          const hd: HotelData = {
            items, lowStock, invested,
            openJobs: openJobsList.length,
            employeesCount: activeEmps.length,
            categories, openJobsList, employeesBySector,
          };
          return [h.id, hd] as const;
        }));

        if (!active) return;
        setData(Object.fromEntries(entries));
      } catch {
        if (active) setData({});
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [currentGroup?.id]);

  const orderedHotels = useMemo(() => {
    if (!selectedHotel?.id) return hotels;
    return [...hotels.filter(h => h.id === selectedHotel.id), ...hotels.filter(h => h.id !== selectedHotel.id)];
  }, [hotels, selectedHotel?.id]);

  const groupTotals = useMemo(() => Object.values(data).reduce(
    (acc, a) => ({
      items: acc.items + a.items, lowStock: acc.lowStock + a.lowStock,
      invested: acc.invested + a.invested, openJobs: acc.openJobs + a.openJobs,
      employeesCount: acc.employeesCount + a.employeesCount,
    }),
    { items: 0, lowStock: 0, invested: 0, openJobs: 0, employeesCount: 0 },
  ), [data]);

  const openScreen = (hotel: HotelRow, path: string) => { setSelectedHotel(hotel as any); navigate(path); };
  const toggle = (key: string) => setOpenKey(prev => prev === key ? null : key);

  if (!currentGroup) {
    return <div className="container mx-auto p-6 text-center text-gray-500 dark:text-gray-400">Selecione um grupo para visualizar o painel.</div>;
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <GroupKpi icon={<Package className="w-4 h-4" />} label="Itens (grupo)" value={loading ? '—' : groupTotals.items.toLocaleString('pt-BR')} color="indigo" />
        <GroupKpi icon={<AlertTriangle className="w-4 h-4" />} label="Estoque baixo" value={loading ? '—' : groupTotals.lowStock.toLocaleString('pt-BR')} color="amber" />
        <GroupKpi icon={<DollarSign className="w-4 h-4" />} label="Valor investido" value={loading ? '—' : formatCurrency(groupTotals.invested)} color="emerald" />
        <GroupKpi icon={<Users className="w-4 h-4" />} label="Colaboradores" value={loading ? '—' : groupTotals.employeesCount.toLocaleString('pt-BR')} color="violet" />
        <GroupKpi icon={<Briefcase className="w-4 h-4" />} label="Vagas abertas" value={loading ? '—' : groupTotals.openJobs.toLocaleString('pt-BR')} color="sky" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : orderedHotels.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Nenhuma unidade ativa no grupo.</p></div>
      ) : (
        <div className="space-y-5">
          {orderedHotels.map(hotel => {
            const d = data[hotel.id] || EMPTY;
            const isCurrent = hotel.id === selectedHotel?.id;
            return (
              <div key={hotel.id}
                className={`rounded-3xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden ${
                  isCurrent ? 'border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-200 dark:ring-indigo-800/50' : 'border-gray-100 dark:border-gray-700'
                }`}>
                {/* Cabeçalho */}
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
                  {isCurrent && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex-shrink-0">Unidade atual</span>}
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4">
                  <UnitKpi label="Itens" value={d.items.toLocaleString('pt-BR')} tone="text-gray-800 dark:text-white" />
                  <UnitKpi label="Estoque baixo" value={d.lowStock.toLocaleString('pt-BR')} tone={d.lowStock > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-white'} />
                  <UnitKpi label="Valor investido" value={formatCurrency(d.invested)} tone="text-emerald-600 dark:text-emerald-400" />
                  <UnitKpi label="Vagas abertas" value={d.openJobs.toLocaleString('pt-BR')} tone={d.openJobs > 0 ? 'text-sky-600 dark:text-sky-400' : 'text-gray-800 dark:text-white'} />
                </div>

                {/* Botões (toggle inline) */}
                <div className="flex flex-wrap gap-2 px-5 pb-3">
                  <Tab label="Inventário"    icon={<Package className="w-3.5 h-3.5" />}      active={openKey === `${hotel.id}:inv`}  onClick={() => toggle(`${hotel.id}:inv`)} />
                  <Tab label="Colaboradores" icon={<Users className="w-3.5 h-3.5" />}        active={openKey === `${hotel.id}:emp`}  onClick={() => toggle(`${hotel.id}:emp`)} />
                  <Tab label="Vagas RH"      icon={<Briefcase className="w-3.5 h-3.5" />}    active={openKey === `${hotel.id}:job`}  onClick={() => toggle(`${hotel.id}:job`)} />
                  <Tab label="Escala"        icon={<CalendarDays className="w-3.5 h-3.5" />} active={openKey === `${hotel.id}:esc`}  onClick={() => toggle(`${hotel.id}:esc`)} />
                  <Tab label="Benefícios"    icon={<Gift className="w-3.5 h-3.5" />}         active={openKey === `${hotel.id}:ben`}  onClick={() => toggle(`${hotel.id}:ben`)} />
                  <Tab label="Transferências" icon={<ArrowLeftRight className="w-3.5 h-3.5" />} active={openKey === `${hotel.id}:tra`} onClick={() => toggle(`${hotel.id}:tra`)} />
                  <Tab label="Café/MAP/FAP"  icon={<Coffee className="w-3.5 h-3.5" />}       active={openKey === `${hotel.id}:caf`}  onClick={() => toggle(`${hotel.id}:caf`)} />
                  <Tab label="Rack de UH"    icon={<HotelIcon className="w-3.5 h-3.5" />}    active={openKey === `${hotel.id}:rac`}  onClick={() => toggle(`${hotel.id}:rac`)} />
                  <Tab label="Manutenção"    icon={<Wrench className="w-3.5 h-3.5" />}       active={openKey === `${hotel.id}:man`}  onClick={() => toggle(`${hotel.id}:man`)} />
                </div>

                {/* Painel inline */}
                <InlinePanel
                  openKey={openKey} hotelId={hotel.id} d={d}
                  formatCurrency={formatCurrency}
                  onOpen={(path) => openScreen(hotel, path)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Painel inline por seção ───────────────────────────────────────────────────

function InlinePanel({ openKey, hotelId, d, formatCurrency, onOpen }: {
  openKey: string | null; hotelId: string; d: HotelData;
  formatCurrency: (v: number) => string; onOpen: (path: string) => void;
}) {
  if (!openKey || !openKey.startsWith(`${hotelId}:`)) return null;
  const section = openKey.split(':')[1];

  const wrap = (children: React.ReactNode) => (
    <div className="px-5 pb-5 pt-1 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-900/30">
      <div className="pt-4">{children}</div>
    </div>
  );

  if (section === 'inv') {
    return wrap(
      <Section title="Inventário por categoria" onOpen={() => onOpen('/inventory')}>
        {d.categories.length === 0 ? <Empty text="Sem produtos cadastrados." /> : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {d.categories.map(c => (
              <div key={c.name} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{c.name}</span>
                <span className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[11px] text-gray-400">{c.items} {c.items === 1 ? 'item' : 'itens'}</span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(c.value)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    );
  }

  if (section === 'emp') {
    return wrap(
      <Section title={`Colaboradores · ${d.employeesCount}`} onOpen={() => onOpen('/personnel-department?tab=employees')}>
        {d.employeesBySector.length === 0 ? <Empty text="Sem colaboradores cadastrados." /> : (
          <div className="flex flex-wrap gap-2">
            {d.employeesBySector.map(s => (
              <span key={s.sector} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm">
                <span className="text-gray-700 dark:text-gray-200">{s.sector}</span>
                <span className="font-bold text-violet-600 dark:text-violet-400">{s.count}</span>
              </span>
            ))}
          </div>
        )}
      </Section>
    );
  }

  if (section === 'job') {
    return wrap(
      <Section title={`Vagas abertas · ${d.openJobsList.length}`} onOpen={() => onOpen('/rh/jobs')}>
        {d.openJobsList.length === 0 ? <Empty text="Nenhuma vaga aberta." /> : (
          <div className="space-y-1.5">
            {d.openJobsList.map((j, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{j.title}</span>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{j.sector}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    );
  }

  // Seções operacionais → abrir tela completa (no contexto da unidade)
  const OPEN_SECTIONS: Record<string, { title: string; desc: string; path: string }> = {
    esc: { title: 'Escala',         desc: 'Abra a escala da unidade para visualizar e editar os turnos.', path: '/personnel-department?tab=schedule' },
    ben: { title: 'Benefícios',     desc: 'Aniversariantes e cestas da unidade.',                         path: '/personnel-department?tab=benefits' },
    tra: { title: 'Transferências', desc: 'Transferências de itens entre unidades do grupo.',              path: '/inventory/transfers' },
    caf: { title: 'Café / MAP / FAP', desc: 'Checklist de hóspedes do café, almoço e jantar.',            path: '/breakfast/hall' },
    rac: { title: 'Rack de UH',     desc: 'Mapa de unidades habitacionais da recepção.',                   path: '/reception/rack' },
    man: { title: 'Manutenção',     desc: 'Chamados e equipamentos da unidade.',                           path: '/maintenance' },
  };
  const cfg = OPEN_SECTIONS[section];
  if (!cfg) return null;
  return wrap(
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-bold text-gray-800 dark:text-white">{cfg.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cfg.desc}</p>
      </div>
      <button onClick={() => onOpen(cfg.path)}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex-shrink-0">
        <ExternalLink className="w-4 h-4" /> Abrir tela completa
      </button>
    </div>
  );
}

function Section({ title, onOpen, children }: { title: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{title}</h3>
        <button onClick={onOpen} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          <ExternalLink className="w-3 h-3" /> Abrir tela
        </button>
      </div>
      {children}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 italic py-2">{text}</p>;
}

const COLOR_MAP: Record<string, string> = {
  indigo:  'bg-indigo-50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400',
  amber:   'bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400',
  violet:  'bg-violet-50 dark:bg-violet-900/10 text-violet-600 dark:text-violet-400',
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

function Tab({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400'
      }`}>
      {icon}{label}
      <ChevronDown className={`w-3 h-3 transition-transform ${active ? 'rotate-180' : ''} opacity-60`} />
    </button>
  );
}
