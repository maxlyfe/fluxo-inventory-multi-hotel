// src/pages/diretoria/DirectorPanel.tsx
// Painel do Diretor — análise consolidada do GRUPO em uma única tela.
// Modelo: escolhe-se uma SEÇÃO (Visão geral, Escala, Colaboradores, Vagas,
// Benefícios, Inventário) e quais UNIDADES renderizar (1, 2 ou todas). O
// conteúdo é renderizado INLINE, lado a lado, para comparar/planejar sem sair
// da tela. O hotel selecionado no topo aparece primeiro e já vem pré-marcado.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import { useFormatters } from '../../hooks/useFormatters';
import { format, addDays, startOfWeek, addWeeks, subWeeks, differenceInMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  LayoutDashboard, Package, AlertTriangle, DollarSign, Briefcase,
  CalendarDays, Users, Gift, Loader2, Building2, Check, Cake,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search, Filter, ImageIcon,
  Phone, Clock,
} from 'lucide-react';

interface HotelRow { id: string; name: string; code?: string | null; [k: string]: any; }
interface Emp { name: string; sector: string; birth_date: string | null; admission_date: string | null; phone: string | null; }
interface Job { title: string; sector: string; }
interface CatAgg { name: string; items: number; value: number; }
interface LightData {
  items: number; lowStock: number; invested: number;
  employees: Emp[]; openJobs: Job[]; categories: CatAgg[];
}
const EMPTY: LightData = { items: 0, lowStock: 0, invested: 0, employees: [], openJobs: [], categories: [] };

type Section = 'overview' | 'escala' | 'colaboradores' | 'vagas' | 'beneficios' | 'inventario';
const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview',      label: 'Visão geral',   icon: LayoutDashboard },
  { id: 'escala',        label: 'Escala',        icon: CalendarDays },
  { id: 'colaboradores', label: 'Colaboradores', icon: Users },
  { id: 'vagas',         label: 'Vagas RH',      icon: Briefcase },
  { id: 'beneficios',    label: 'Benefícios',    icon: Gift },
  { id: 'inventario',    label: 'Inventário',    icon: Package },
];

export default function DirectorPanel() {
  const { selectedHotel } = useHotel();
  const { currentGroup } = useGroup();
  const { formatCurrency } = useFormatters();

  const [hotels, setHotels]   = useState<HotelRow[]>([]);
  const [data, setData]       = useState<Record<string, LightData>>({});
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('overview');
  const [units, setUnits]     = useState<Set<string>>(new Set());
  const [week, setWeek]       = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 0 }));

  // ── Carrega hotéis + dados leves (inventário/colaboradores/vagas) por hotel ──
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
        // Pré-seleciona a unidade atual (ou a 1ª)
        const initial = selectedHotel?.id && list.some(h => h.id === selectedHotel.id)
          ? selectedHotel.id : list[0]?.id;
        setUnits(initial ? new Set([initial]) : new Set());
        if (list.length === 0) { setData({}); setLoading(false); return; }

        const entries = await Promise.all(list.map(async (h) => {
          const [{ data: products }, { data: jobs }, { data: emps }] = await Promise.all([
            supabase.from('products').select('quantity, min_quantity, average_price, is_active, category').eq('hotel_id', h.id),
            supabase.from('job_openings').select('title, sector, status').eq('hotel_id', h.id),
            supabase.from('employees').select('name, sector, birth_date, admission_date, phone, status').eq('hotel_id', h.id).eq('status', 'active'),
          ]);
          const prods = products || [];
          const items = prods.length;
          let lowStock = 0, invested = 0;
          const catMap = new Map<string, CatAgg>();
          prods.forEach((p: any) => {
            const qty = Number(p.quantity) || 0, min = Number(p.min_quantity) || 0, avg = Number(p.average_price) || 0;
            const isActive = p.is_active !== false;
            if (isActive && qty <= min) lowStock++;
            const val = isActive ? avg * qty : 0;
            if (isActive) invested += val;
            const cat = p.category || 'Sem categoria';
            const c = catMap.get(cat) || { name: cat, items: 0, value: 0 };
            c.items++; c.value += val; catMap.set(cat, c);
          });
          const ld: LightData = {
            items, lowStock, invested,
            categories: [...catMap.values()].sort((a, b) => b.value - a.value),
            employees: (emps || []).map((e: any) => ({ name: e.name, sector: e.sector || 'Sem setor', birth_date: e.birth_date, admission_date: e.admission_date, phone: e.phone })),
            openJobs: (jobs || []).filter((j: any) => j.status === 'open').map((j: any) => ({ title: j.title, sector: j.sector })),
          };
          return [h.id, ld] as const;
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

  // Unidades selecionadas, na ordem: atual primeiro, depois as demais.
  const orderedSelected = useMemo(() => {
    const ordered = [
      ...hotels.filter(h => h.id === selectedHotel?.id),
      ...hotels.filter(h => h.id !== selectedHotel?.id),
    ];
    return ordered.filter(h => units.has(h.id));
  }, [hotels, units, selectedHotel?.id]);

  const toggleUnit = (id: string) =>
    setUnits(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const groupTotals = useMemo(() => Object.values(data).reduce(
    (a, d) => ({ items: a.items + d.items, lowStock: a.lowStock + d.lowStock, invested: a.invested + d.invested, emp: a.emp + d.employees.length, jobs: a.jobs + d.openJobs.length }),
    { items: 0, lowStock: 0, invested: 0, emp: 0, jobs: 0 },
  ), [data]);

  if (!currentGroup) {
    return <div className="container mx-auto p-6 text-center text-gray-500 dark:text-gray-400">Selecione um grupo para visualizar o painel.</div>;
  }

  const showUnitPicker = section !== 'overview';
  // Largura das colunas conforme nº de unidades (responsivo)
  const colClass = orderedSelected.length <= 1 ? 'grid-cols-1'
    : orderedSelected.length === 2 ? 'grid-cols-1 lg:grid-cols-2'
    : 'grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3';

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <LayoutDashboard className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white leading-tight">Painel do Diretor</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Análise consolidada · {currentGroup.name}</p>
        </div>
      </div>

      {/* Seletor de seção */}
      <div className="flex flex-wrap gap-2 mb-4">
        {SECTIONS.map(s => {
          const Icon = s.icon; const active = section === s.id;
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                active ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                       : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-300'
              }`}>
              <Icon className="w-4 h-4" />{s.label}
            </button>
          );
        })}
      </div>

      {/* Seletor de unidades (multi) */}
      {showUnitPicker && (
        <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">Unidades</span>
          {hotels.map(h => {
            const on = units.has(h.id);
            const isCurrent = h.id === selectedHotel?.id;
            return (
              <button key={h.id} onClick={() => toggleUnit(h.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                }`}>
                {on && <Check className="w-3 h-3" />}
                {h.name}{isCurrent && <span className={`ml-0.5 ${on ? 'text-white/70' : 'text-indigo-400'}`}>•</span>}
              </button>
            );
          })}
          <div className="ml-auto flex gap-2">
            <button onClick={() => setUnits(new Set(hotels.map(h => h.id)))} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Todas</button>
            <button onClick={() => setUnits(new Set())} className="text-xs font-semibold text-gray-400 hover:underline">Limpar</button>
          </div>
        </div>
      )}

      {/* Navegação de semana (só na Escala) */}
      {section === 'escala' && (
        <div className="flex items-center justify-center gap-2 mb-5">
          <button onClick={() => setWeek(w => subWeeks(w, 1))} className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300"><ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
          <span className="text-sm font-bold text-gray-700 dark:text-gray-200 px-3 min-w-[220px] text-center">
            Semana de {format(week, "dd 'de' MMM", { locale: ptBR })} a {format(addDays(week, 6), "dd 'de' MMM", { locale: ptBR })}
          </span>
          <button onClick={() => setWeek(w => addWeeks(w, 1))} className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300"><ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
        </div>
      )}

      {/* Conteúdo */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : section === 'overview' ? (
        <OverviewSection hotels={hotels} data={data} groupTotals={groupTotals} formatCurrency={formatCurrency} selectedId={selectedHotel?.id} />
      ) : orderedSelected.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Selecione ao menos uma unidade acima.</p></div>
      ) : section === 'escala' ? (
        <EscalaComparison hotels={orderedSelected} week={week} colClass={colClass} selectedId={selectedHotel?.id} />
      ) : (
        <div className={`grid ${colClass} gap-4`}>
          {orderedSelected.map(h => (
            <UnitColumn key={h.id} hotel={h} section={section} data={data[h.id] || EMPTY}
              formatCurrency={formatCurrency} isCurrent={h.id === selectedHotel?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coluna por unidade ────────────────────────────────────────────────────────

function UnitColumn({ hotel, section, data, formatCurrency, isCurrent }: {
  hotel: HotelRow; section: Section; data: LightData;
  formatCurrency: (v: number) => string; isCurrent: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden ${isCurrent ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-100 dark:border-gray-700'}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700/60 sticky top-0 bg-white dark:bg-gray-800 z-10">
        <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-white truncate flex-1">{hotel.name}</h2>
        {isCurrent && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">atual</span>}
      </div>
      <div className="p-4">
        {section === 'colaboradores' && <Colaboradores data={data} />}
        {section === 'vagas'        && <Vagas data={data} />}
        {section === 'beneficios'   && <Beneficios data={data} />}
        {section === 'inventario'   && <InventarioCompleto hotelId={hotel.id} formatCurrency={formatCurrency} />}
      </div>
    </div>
  );
}

// ── Seções (read views) ───────────────────────────────────────────────────────

function formatTenure(admissionDate: string): string {
  const months = differenceInMonths(new Date(), new Date(admissionDate + 'T12:00:00'));
  if (months < 1) return 'Menos de 1 mês';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  if (m === 0) return `${y} ${y === 1 ? 'ano' : 'anos'}`;
  return `${y}a ${m}m`;
}

function EmpBadge({ emp }: { emp: Emp }) {
  const [hover, setHover] = useState(false);
  const hasExtra = emp.admission_date || emp.phone;
  return (
    <span className="relative"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-default">{emp.name}</span>
      {hover && hasExtra && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[11px] shadow-lg whitespace-nowrap pointer-events-none">
          <p className="font-bold mb-0.5">{emp.name}</p>
          {emp.admission_date && (
            <p className="flex items-center gap-1 text-gray-300"><Clock className="w-3 h-3" /> {formatTenure(emp.admission_date)}</p>
          )}
          {emp.phone && (
            <p className="flex items-center gap-1 text-gray-300"><Phone className="w-3 h-3" /> {emp.phone}</p>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </div>
      )}
    </span>
  );
}

function Colaboradores({ data }: { data: LightData }) {
  const bySector = useMemo(() => {
    const m = new Map<string, Emp[]>();
    data.employees.forEach(e => { const a = m.get(e.sector) || []; a.push(e); m.set(e.sector, a); });
    return [...m.entries()].map(([sector, emps]) => ({ sector, emps })).sort((a, b) => b.emps.length - a.emps.length);
  }, [data.employees]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (s: string) => setCollapsed(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  if (data.employees.length === 0) return <Empty text="Sem colaboradores ativos." />;
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{data.employees.length} colaboradores ativos</p>
      {bySector.map(s => {
        const isOpen = !collapsed.has(s.sector);
        return (
          <div key={s.sector}>
            <button onClick={() => toggle(s.sector)} className="flex items-center justify-between w-full mb-1 group">
              <span className="flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {s.sector}
              </span>
              <span className="text-xs font-bold text-violet-600 dark:text-violet-400">{s.emps.length}</span>
            </button>
            {isOpen && (
              <div className="flex flex-wrap gap-1">
                {s.emps.map((e, i) => <EmpBadge key={i} emp={e} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Vagas({ data }: { data: LightData }) {
  if (data.openJobs.length === 0) return <Empty text="Nenhuma vaga aberta." />;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">{data.openJobs.length} vaga(s) aberta(s)</p>
      {data.openJobs.map((j, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{j.title}</span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{j.sector}</span>
        </div>
      ))}
    </div>
  );
}

function Beneficios({ data }: { data: LightData }) {
  const month = new Date().getMonth();
  const birthdays = useMemo(() => data.employees
    .filter(e => e.birth_date && new Date(e.birth_date + 'T12:00:00').getMonth() === month)
    .map(e => ({ name: e.name, sector: e.sector, day: new Date(e.birth_date! + 'T12:00:00').getDate() }))
    .sort((a, b) => a.day - b.day), [data.employees, month]);

  return (
    <div>
      <p className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
        <Cake className="w-4 h-4 text-pink-500" /> Aniversariantes do mês
      </p>
      {birthdays.length === 0 ? <Empty text="Nenhum aniversariante este mês." /> : (
        <div className="space-y-1.5">
          {birthdays.map((b, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-pink-50 dark:bg-pink-900/10 border border-pink-100 dark:border-pink-900/30">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{b.name}</span>
              <span className="text-xs flex-shrink-0"><span className="text-gray-400">{b.sector} · </span><span className="font-bold text-pink-600 dark:text-pink-400">dia {b.day}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inventário completo (inventário central + estoques setoriais) ────────────

interface SectorInfo { id: string; name: string; }
interface ProductRow {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  quantity: number;
  average_price: number;
  is_active: boolean;
}
interface SectorStockRow { sector_id: string; product_id: string; quantity: number; }
interface AggregatedItem {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  inventoryQty: number;
  sectorQtys: Record<string, number>;
  totalQty: number;
  unitValue: number;
}

function InventarioCompleto({ hotelId, formatCurrency }: { hotelId: string; formatCurrency: (v: number) => string }) {
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [items, setItems] = useState<AggregatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [{ data: prods }, { data: sectorStocks }, { data: secs }] = await Promise.all([
          supabase.from('products')
            .select('id, name, image_url, category, quantity, average_price, is_active')
            .eq('hotel_id', hotelId).eq('is_active', true).order('name'),
          supabase.from('sector_stock')
            .select('sector_id, product_id, quantity')
            .eq('hotel_id', hotelId),
          supabase.from('sectors')
            .select('id, name')
            .eq('hotel_id', hotelId).eq('has_stock', true).order('name'),
        ]);
        if (!active) return;

        const sectorList = (secs || []) as SectorInfo[];
        setSectors(sectorList);
        setSelectedSectors(new Set(sectorList.map(s => s.id)));

        const ssMap = new Map<string, Record<string, number>>();
        for (const ss of (sectorStocks || []) as SectorStockRow[]) {
          if (!ssMap.has(ss.product_id)) ssMap.set(ss.product_id, {});
          ssMap.get(ss.product_id)![ss.sector_id] = ss.quantity;
        }

        const aggregated: AggregatedItem[] = ((prods || []) as ProductRow[]).map(p => {
          const sectorQtys = ssMap.get(p.id) || {};
          const sectorTotal = Object.values(sectorQtys).reduce((a, b) => a + b, 0);
          return {
            id: p.id,
            name: p.name,
            image_url: p.image_url,
            category: p.category || 'Sem categoria',
            inventoryQty: p.quantity,
            sectorQtys,
            totalQty: p.quantity + sectorTotal,
            unitValue: p.average_price || 0,
          };
        });
        setItems(aggregated);
      } catch { /* ignore */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [hotelId]);

  const toggleSector = (id: string) =>
    setSelectedSectors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const categories = useMemo(() =>
    [...new Set(items.map(i => i.category))].sort(),
  [items]);

  const activeSectors = useMemo(() =>
    sectors.filter(s => selectedSectors.has(s.id)),
  [sectors, selectedSectors]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return items.filter(i => {
      if (term && !i.name.toLowerCase().includes(term)) return false;
      if (selectedCategory && i.category !== selectedCategory) return false;
      return true;
    });
  }, [items, searchTerm, selectedCategory]);

  const totals = useMemo(() => {
    const inv = filtered.reduce((a, i) => a + i.inventoryQty, 0);
    const sec = filtered.reduce((a, i) => {
      return a + activeSectors.reduce((s, sec) => s + (i.sectorQtys[sec.id] || 0), 0);
    }, 0);
    const value = filtered.reduce((a, i) => a + i.totalQty * i.unitValue, 0);
    return { inv, sec, total: inv + sec, value, items: filtered.length };
  }, [filtered, activeSectors]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>;

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2">
        <MiniKpi label="Itens" value={totals.items.toLocaleString('pt-BR')} />
        <MiniKpi label="Valor total" value={formatCurrency(totals.value)} tone="text-emerald-600 dark:text-emerald-400" />
        <MiniKpi label="Inventário" value={totals.inv.toLocaleString('pt-BR')} tone="text-blue-600 dark:text-blue-400" />
        <MiniKpi label="Setores" value={totals.sec.toLocaleString('pt-BR')} tone="text-violet-600 dark:text-violet-400" />
      </div>

      {/* Filtro de setores */}
      {sectors.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Setores</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setSelectedSectors(new Set(sectors.map(s => s.id)))}
                className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Todos</button>
              <button onClick={() => setSelectedSectors(new Set())}
                className="text-[10px] font-semibold text-gray-400 hover:underline">Limpar</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {sectors.map(s => {
              const on = selectedSectors.has(s.id);
              return (
                <button key={s.id} onClick={() => toggleSector(s.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                    on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                  }`}>
                  {on && <Check className="w-2.5 h-2.5 inline mr-0.5" />}{s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Busca + filtro de categoria */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar produto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-600 rounded-xl pl-8 pr-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-600 rounded-xl px-2 py-2 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 max-w-[120px]"
        >
          <option value="">Todas cat.</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Tabela de produtos */}
      {filtered.length === 0 ? <Empty text="Nenhum produto encontrado." /> : (
        <div className="max-h-[500px] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
              <tr>
                <th className="p-2 text-left text-gray-600 dark:text-gray-300 font-bold">Produto</th>
                <th className="p-2 text-right text-blue-600 dark:text-blue-400 font-bold whitespace-nowrap" title="Inventário central">Inv.</th>
                {activeSectors.map(s => (
                  <th key={s.id} className="p-2 text-right text-violet-600 dark:text-violet-400 font-bold whitespace-nowrap max-w-[60px] truncate" title={s.name}>
                    {s.name.length > 6 ? s.name.slice(0, 5) + '…' : s.name}
                  </th>
                ))}
                <th className="p-2 text-right text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {filtered.map(item => {
                const sectorSum = activeSectors.reduce((a, s) => a + (item.sectorQtys[s.id] || 0), 0);
                const rowTotal = item.inventoryQty + sectorSum;
                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="p-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="w-7 h-7 rounded-md object-contain bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 dark:text-white truncate leading-tight">{item.name}</p>
                          <p className="text-[10px] text-gray-400 truncate">{item.category}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-right font-bold text-blue-600 dark:text-blue-400 tabular-nums">{item.inventoryQty}</td>
                    {activeSectors.map(s => {
                      const qty = item.sectorQtys[s.id] || 0;
                      return (
                        <td key={s.id} className={`p-2 text-right tabular-nums ${qty > 0 ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}>
                          {qty}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-700/50 sticky bottom-0">
              <tr className="font-black text-xs">
                <td className="p-2 text-gray-700 dark:text-gray-200">TOTAL ({filtered.length})</td>
                <td className="p-2 text-right text-blue-600 dark:text-blue-400 tabular-nums">{totals.inv.toLocaleString('pt-BR')}</td>
                {activeSectors.map(s => {
                  const sectorTotal = filtered.reduce((a, i) => a + (i.sectorQtys[s.id] || 0), 0);
                  return <td key={s.id} className="p-2 text-right text-violet-600 dark:text-violet-400 tabular-nums">{sectorTotal.toLocaleString('pt-BR')}</td>;
                })}
                <td className="p-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{totals.total.toLocaleString('pt-BR')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Escala (grid semanal read-only, por hotel) ────────────────────────────────

interface SchedEntry { employee_id: string; day_date: string; entry_type: string; shift_start: string | null; shift_end: string | null; }
interface SchedEmp { id: string; name: string; sector: string; }

const ENTRY_LABEL: Record<string, { label: string; cls: string }> = {
  folga:     { label: 'Folga',   cls: 'text-gray-400' },
  compensa:  { label: 'Comp.',   cls: 'text-gray-400' },
  ferias:    { label: 'Férias',  cls: 'text-emerald-600 dark:text-emerald-400' },
  falta:     { label: 'Falta',   cls: 'text-red-500' },
  atestado:  { label: 'Atest.',  cls: 'text-orange-500' },
  inss:      { label: 'INSS',    cls: 'text-purple-500' },
  curso:     { label: 'Curso',   cls: 'text-blue-500' },
  meia_dobra:{ label: '½/Dobra', cls: 'text-gray-600 dark:text-gray-300' },
  transfer:  { label: 'Transf.', cls: 'text-cyan-600 dark:text-cyan-400' },
};

// Altura fixa de cada linha (garante o alinhamento dos blocos entre colunas).
const ROW_H = 38;        // linha de colaborador
const SECTOR_H = 26;     // cabeçalho de setor
const HEAD_H = 34;       // cabeçalho dos dias

interface HotelSched {
  empsBySector: Record<string, SchedEmp[]>;
  entries: Record<string, SchedEntry>;   // `${empId}|${yyyy-mm-dd}`
  hasSchedule: boolean;
}

function EscalaComparison({ hotels, week, colClass, selectedId }: {
  hotels: HotelRow[]; week: Date; colClass: string; selectedId?: string;
}) {
  const [perHotel, setPerHotel] = useState<Record<string, HotelSched>>({});
  const [loading, setLoading]   = useState(true);

  const weekStr = format(week, 'yyyy-MM-dd');
  const hotelIds = hotels.map(h => h.id).join(',');
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const entries = await Promise.all(hotels.map(async (h) => {
          const [{ data: empRows }, { data: sched }] = await Promise.all([
            supabase.from('employees').select('id, name, sector').eq('hotel_id', h.id).eq('status', 'active').order('sector').order('name'),
            supabase.from('schedules').select('id').eq('hotel_id', h.id).eq('week_start', weekStr).maybeSingle(),
          ]);
          const empsBySector: Record<string, SchedEmp[]> = {};
          ((empRows || []) as SchedEmp[]).forEach(e => {
            const s = e.sector || 'Sem setor';
            (empsBySector[s] = empsBySector[s] || []).push(e);
          });
          let entryMap: Record<string, SchedEntry> = {};
          let hasSchedule = false;
          if (sched?.id) {
            hasSchedule = true;
            const { data: ent } = await supabase.from('schedule_entries')
              .select('employee_id, day_date, entry_type, shift_start, shift_end').eq('schedule_id', sched.id);
            (ent || []).forEach((e: any) => { entryMap[`${e.employee_id}|${String(e.day_date).slice(0, 10)}`] = e; });
          }
          return [h.id, { empsBySector, entries: entryMap, hasSchedule } as HotelSched] as const;
        }));
        if (!active) return;
        setPerHotel(Object.fromEntries(entries));
      } catch {
        if (active) setPerHotel({});
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hotelIds, weekStr]);

  // Layout COMPARTILHADO: união de setores + máximo de linhas por setor entre os
  // hotéis. Cada coluna renderiza os mesmos setores com o mesmo nº de linhas
  // (preenchendo vazias) → os blocos de setor ficam alinhados entre as unidades.
  const layout = useMemo(() => {
    const sectorMax = new Map<string, number>();
    Object.values(perHotel).forEach(hs => {
      Object.entries(hs.empsBySector).forEach(([sector, list]) => {
        sectorMax.set(sector, Math.max(sectorMax.get(sector) || 0, list.length));
      });
    });
    return [...sectorMax.entries()]
      .map(([sector, maxRows]) => ({ sector, maxRows }))
      .sort((a, b) => a.sector.localeCompare(b.sector, 'pt-BR'));
  }, [perHotel]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  return (
    <div className={`grid ${colClass} gap-4 items-start`}>
      {hotels.map(h => (
        <EscalaColumn key={h.id} hotel={h} isCurrent={h.id === selectedId}
          sched={perHotel[h.id]} layout={layout} days={days} />
      ))}
    </div>
  );
}

function EscalaColumn({ hotel, isCurrent, sched, layout, days }: {
  hotel: HotelRow; isCurrent: boolean; sched?: HotelSched;
  layout: { sector: string; maxRows: number }[]; days: Date[];
}) {
  const entries = sched?.entries || {};
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (s: string) => setCollapsed(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const cell = (empId: string, day: Date) => {
    const e = entries[`${empId}|${format(day, 'yyyy-MM-dd')}`];
    if (!e || e.entry_type === 'empty') return <span className="text-gray-300 dark:text-gray-600">·</span>;
    if (e.entry_type === 'shift' && e.shift_start && e.shift_end)
      return <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-200 leading-[1.15] whitespace-nowrap text-center">{e.shift_start.slice(0, 5)}<br />{e.shift_end.slice(0, 5)}</span>;
    const m = ENTRY_LABEL[e.entry_type];
    return <span className={`text-[10px] font-bold ${m?.cls || 'text-gray-500'}`}>{m?.label || e.entry_type}</span>;
  };

  const gridCols = `28% repeat(7, 1fr)`;

  return (
    <div className={`rounded-2xl border bg-white dark:bg-gray-800 shadow-sm ${isCurrent ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-100 dark:border-gray-700'}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700/60">
        <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-white truncate flex-1">{hotel.name}</h2>
        {isCurrent && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">atual</span>}
      </div>
      <div className="p-2">
        {sched && !sched.hasSchedule && <p className="text-[11px] text-amber-500 px-1 mb-1">Escala ainda não criada para esta semana.</p>}

        {/* Cabeçalho de dias — sticky no topo */}
        <div className="grid sticky z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" style={{ gridTemplateColumns: gridCols, height: HEAD_H, top: '3.5rem' }}>
          <div className="flex items-center text-[10px] font-bold text-gray-400 uppercase px-1">Colab.</div>
          {days.map((d, i) => (
            <div key={i} className="flex flex-col items-center justify-center text-[10px] font-bold text-gray-400 uppercase leading-tight">
              <span>{format(d, 'EEEEEE', { locale: ptBR })}</span>
              <span className="text-gray-300 dark:text-gray-600">{format(d, 'dd')}</span>
            </div>
          ))}
        </div>

        {layout.map(({ sector, maxRows }) => {
          const list = sched?.empsBySector[sector] || [];
          const isOpen = !collapsed.has(sector);
          return (
            <div key={sector}>
              <button onClick={() => toggle(sector)}
                className="flex items-center w-full bg-indigo-50/60 dark:bg-indigo-900/15 text-[10px] font-black text-indigo-600 dark:text-indigo-300 uppercase tracking-wider px-2 gap-1 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/25 transition-colors"
                style={{ height: SECTOR_H }}>
                {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                {sector}
                <span className="ml-auto text-[9px] font-bold text-indigo-400 dark:text-indigo-500">{list.length}</span>
              </button>
              {isOpen && Array.from({ length: maxRows }).map((_, r) => {
                const emp = list[r];
                return (
                  <div key={r} className="grid border-b border-gray-100 dark:border-gray-700/50"
                    style={{ gridTemplateColumns: gridCols }}>
                    <div className="flex items-center px-1.5 overflow-hidden" style={{ height: ROW_H }}>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate">
                        {emp ? emp.name : <span className="text-gray-200 dark:text-gray-700">—</span>}
                      </span>
                    </div>
                    {days.map((d, i) => (
                      <div key={i} className="flex items-center justify-center overflow-hidden border-l border-gray-50 dark:border-gray-700/30"
                        style={{ height: ROW_H }}>
                        {emp ? cell(emp.id, d) : null}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Visão geral ───────────────────────────────────────────────────────────────

function OverviewSection({ hotels, data, groupTotals, formatCurrency, selectedId }: {
  hotels: HotelRow[]; data: Record<string, LightData>;
  groupTotals: { items: number; lowStock: number; invested: number; emp: number; jobs: number };
  formatCurrency: (v: number) => string; selectedId?: string;
}) {
  const ordered = [...hotels.filter(h => h.id === selectedId), ...hotels.filter(h => h.id !== selectedId)];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <GroupKpi icon={<Package className="w-4 h-4" />} label="Itens (grupo)" value={groupTotals.items.toLocaleString('pt-BR')} color="indigo" />
        <GroupKpi icon={<AlertTriangle className="w-4 h-4" />} label="Estoque baixo" value={groupTotals.lowStock.toLocaleString('pt-BR')} color="amber" />
        <GroupKpi icon={<DollarSign className="w-4 h-4" />} label="Valor investido" value={formatCurrency(groupTotals.invested)} color="emerald" />
        <GroupKpi icon={<Users className="w-4 h-4" />} label="Colaboradores" value={groupTotals.emp.toLocaleString('pt-BR')} color="violet" />
        <GroupKpi icon={<Briefcase className="w-4 h-4" />} label="Vagas abertas" value={groupTotals.jobs.toLocaleString('pt-BR')} color="sky" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {ordered.map(h => {
          const d = data[h.id] || EMPTY;
          return (
            <div key={h.id} className={`rounded-2xl border bg-white dark:bg-gray-800 shadow-sm p-4 ${h.id === selectedId ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-100 dark:border-gray-700'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate flex-1">{h.name}</h3>
                {h.id === selectedId && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">atual</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniKpi label="Itens" value={d.items.toLocaleString('pt-BR')} />
                <MiniKpi label="Estoque baixo" value={d.lowStock.toLocaleString('pt-BR')} tone={d.lowStock > 0 ? 'text-amber-600 dark:text-amber-400' : ''} />
                <MiniKpi label="Valor investido" value={formatCurrency(d.invested)} tone="text-emerald-600 dark:text-emerald-400" />
                <MiniKpi label="Colaboradores" value={d.employees.length.toLocaleString('pt-BR')} tone="text-violet-600 dark:text-violet-400" />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Átomos ────────────────────────────────────────────────────────────────────

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

function MiniKpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-2.5 text-center">
      <p className="text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-0.5 truncate">{label}</p>
      <p className={`text-sm font-black truncate ${tone || 'text-gray-800 dark:text-white'}`}>{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 italic py-3 text-center">{text}</p>;
}
