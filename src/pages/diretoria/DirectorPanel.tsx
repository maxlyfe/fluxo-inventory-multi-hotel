// src/pages/diretoria/DirectorPanel.tsx
// Painel do Diretor — análise consolidada do GRUPO em uma única tela.
// Modelo: escolhe-se uma SEÇÃO (Visão geral, Escala, Colaboradores, Vagas,
// Benefícios, Inventário) e quais UNIDADES renderizar (1, 2 ou todas). O
// conteúdo é renderizado INLINE, lado a lado, para comparar/planejar sem sair
// da tela. O hotel selecionado no topo aparece primeiro e já vem pré-marcado.

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useGroup } from '../../context/GroupContext';
import { useFormatters } from '../../hooks/useFormatters';
import { format, addDays, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  LayoutDashboard, Package, AlertTriangle, DollarSign, Briefcase,
  CalendarDays, Users, Gift, Loader2, Building2, Check, Cake,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

interface HotelRow { id: string; name: string; code?: string | null; [k: string]: any; }
interface Emp { name: string; sector: string; birth_date: string | null; }
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
            supabase.from('employees').select('name, sector, birth_date, status').eq('hotel_id', h.id).eq('status', 'active'),
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
            employees: (emps || []).map((e: any) => ({ name: e.name, sector: e.sector || 'Sem setor', birth_date: e.birth_date })),
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
      ) : (
        <div className={`grid ${colClass} gap-4`}>
          {orderedSelected.map(h => (
            <UnitColumn key={h.id} hotel={h} section={section} data={data[h.id] || EMPTY}
              week={week} formatCurrency={formatCurrency} isCurrent={h.id === selectedHotel?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coluna por unidade ────────────────────────────────────────────────────────

function UnitColumn({ hotel, section, data, week, formatCurrency, isCurrent }: {
  hotel: HotelRow; section: Section; data: LightData; week: Date;
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
        {section === 'inventario'   && <Inventario data={data} formatCurrency={formatCurrency} />}
        {section === 'escala'       && <EscalaGrid hotelId={hotel.id} week={week} />}
      </div>
    </div>
  );
}

// ── Seções (read views) ───────────────────────────────────────────────────────

function Colaboradores({ data }: { data: LightData }) {
  const bySector = useMemo(() => {
    const m = new Map<string, string[]>();
    data.employees.forEach(e => { const a = m.get(e.sector) || []; a.push(e.name); m.set(e.sector, a); });
    return [...m.entries()].map(([sector, names]) => ({ sector, names })).sort((a, b) => b.names.length - a.names.length);
  }, [data.employees]);

  if (data.employees.length === 0) return <Empty text="Sem colaboradores ativos." />;
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{data.employees.length} colaboradores ativos</p>
      {bySector.map(s => (
        <div key={s.sector}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{s.sector}</span>
            <span className="text-xs font-bold text-violet-600 dark:text-violet-400">{s.names.length}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {s.names.map((n, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{n}</span>
            ))}
          </div>
        </div>
      ))}
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

function Inventario({ data, formatCurrency }: { data: LightData; formatCurrency: (v: number) => string }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniKpi label="Itens" value={data.items.toLocaleString('pt-BR')} />
        <MiniKpi label="Baixo" value={data.lowStock.toLocaleString('pt-BR')} tone={data.lowStock > 0 ? 'text-amber-600 dark:text-amber-400' : ''} />
        <MiniKpi label="Valor" value={formatCurrency(data.invested)} tone="text-emerald-600 dark:text-emerald-400" />
      </div>
      {data.categories.length === 0 ? <Empty text="Sem produtos." /> : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {data.categories.map(c => (
            <div key={c.name} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{c.name}</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[11px] text-gray-400">{c.items}</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(c.value)}</span>
              </span>
            </div>
          ))}
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

function EscalaGrid({ hotelId, week }: { hotelId: string; week: Date }) {
  const [emps, setEmps]     = useState<SchedEmp[]>([]);
  const [entries, setEntries] = useState<Record<string, SchedEntry>>({}); // key `${empId}|${yyyy-mm-dd}`
  const [loading, setLoading] = useState(true);
  const [hasSchedule, setHasSchedule] = useState(false);

  const weekStr = format(week, 'yyyy-MM-dd');
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [{ data: empRows }, { data: sched }] = await Promise.all([
          supabase.from('employees').select('id, name, sector').eq('hotel_id', hotelId).eq('status', 'active').order('sector').order('name'),
          supabase.from('schedules').select('id').eq('hotel_id', hotelId).eq('week_start', weekStr).maybeSingle(),
        ]);
        if (!active) return;
        setEmps((empRows || []) as SchedEmp[]);
        if (sched?.id) {
          setHasSchedule(true);
          const { data: ent } = await supabase.from('schedule_entries')
            .select('employee_id, day_date, entry_type, shift_start, shift_end').eq('schedule_id', sched.id);
          if (!active) return;
          const map: Record<string, SchedEntry> = {};
          (ent || []).forEach((e: any) => { map[`${e.employee_id}|${String(e.day_date).slice(0, 10)}`] = e; });
          setEntries(map);
        } else {
          setHasSchedule(false);
          setEntries({});
        }
      } catch {
        if (active) { setEmps([]); setEntries({}); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hotelId, weekStr]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>;
  if (emps.length === 0) return <Empty text="Sem colaboradores ativos." />;

  // Agrupa por setor
  const bySector = new Map<string, SchedEmp[]>();
  emps.forEach(e => { const a = bySector.get(e.sector) || []; a.push(e); bySector.set(e.sector, a); });

  const renderCell = (empId: string, day: Date) => {
    const e = entries[`${empId}|${format(day, 'yyyy-MM-dd')}`];
    if (!e || e.entry_type === 'empty') return <span className="text-gray-300 dark:text-gray-600">·</span>;
    if (e.entry_type === 'shift' && e.shift_start && e.shift_end)
      return <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{e.shift_start.slice(0, 5)}<br />{e.shift_end.slice(0, 5)}</span>;
    const m = ENTRY_LABEL[e.entry_type];
    return <span className={`text-[10px] font-bold ${m?.cls || 'text-gray-500'}`}>{m?.label || e.entry_type}</span>;
  };

  return (
    <div className="overflow-x-auto -mx-1">
      {!hasSchedule && <p className="text-[11px] text-amber-500 mb-2">Escala ainda não criada para esta semana.</p>}
      <table className="w-full border-collapse text-center">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-1 py-1 sticky left-0 bg-white dark:bg-gray-800">Colab.</th>
            {days.map((d, i) => (
              <th key={i} className="text-[10px] font-bold text-gray-400 uppercase px-1 py-1 min-w-[40px]">
                {format(d, 'EEEEEE', { locale: ptBR })}<br /><span className="text-gray-300 dark:text-gray-600">{format(d, 'dd')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...bySector.entries()].map(([sector, list]) => (
            <React.Fragment key={sector}>
              <tr><td colSpan={8} className="text-left text-[10px] font-black text-indigo-500 uppercase tracking-wider pt-2 pb-0.5 px-1">{sector}</td></tr>
              {list.map(emp => (
                <tr key={emp.id} className="border-t border-gray-50 dark:border-gray-700/40">
                  <td className="text-left text-[11px] font-medium text-gray-700 dark:text-gray-200 px-1 py-1 sticky left-0 bg-white dark:bg-gray-800 truncate max-w-[110px]">{emp.name}</td>
                  {days.map((d, i) => <td key={i} className="px-1 py-1 leading-tight">{renderCell(emp.id, d)}</td>)}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
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
