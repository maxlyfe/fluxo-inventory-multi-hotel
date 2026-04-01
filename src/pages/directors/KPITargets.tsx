// src/pages/directors/KPITargets.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Target, Save, ChevronLeft, ChevronRight,
  RefreshCw, Building2, Plus,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';

/* ------------------------------------------------------------------ */
/*  KPI definitions                                                    */
/* ------------------------------------------------------------------ */
const KPI_DEFS: { key: string; label: string; unit: string; color: string }[] = [
  { key: 'occupancy',        label: 'Ocupação',         unit: '%',   color: '#6366f1' },
  { key: 'adr',              label: 'ADR',              unit: 'R$',  color: '#8b5cf6' },
  { key: 'revpar',           label: 'RevPAR',           unit: 'R$',  color: '#3b82f6' },
  { key: 'revenue',          label: 'Receita Total',    unit: 'R$',  color: '#22c55e' },
  { key: 'turnover',         label: 'Turnover',         unit: '%',   color: '#ef4444' },
  { key: 'maintenance_sla',  label: 'SLA Manutenção',   unit: 'h',   color: '#f59e0b' },
  { key: 'absenteeism',      label: 'Absenteísmo',      unit: '%',   color: '#f97316' },
  { key: 'headcount',        label: 'Headcount',        unit: '',    color: '#14b8a6' },
  { key: 'csat',             label: 'Satisfação (NPS)',  unit: '',    color: '#ec4899' },
];

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Hotel { id: string; name: string; code: string; }

interface TargetRow {
  kpi_key: string;
  months: (number | null)[]; // 12 values, index 0 = January
}

export default function KPITargets() {
  const { selectedHotel } = useHotel();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [targetHotel, setTargetHotel] = useState<string | null>(null); // null = rede
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('hotels').select('id, name, code').order('name');
      if (data) {
        setHotels(data);
        if (selectedHotel) setTargetHotel(selectedHotel.id);
      }
    })();
  }, [selectedHotel]);

  useEffect(() => {
    loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetHotel, year]);

  async function loadTargets() {
    setLoading(true);
    let q = supabase
      .from('kpi_targets')
      .select('*')
      .eq('year', year);

    if (targetHotel) {
      q = q.eq('hotel_id', targetHotel);
    } else {
      q = q.is('hotel_id', null);
    }

    const { data } = await q;

    // Build rows from KPI_DEFS
    const newRows: TargetRow[] = KPI_DEFS.map(def => {
      const months: (number | null)[] = Array(12).fill(null);
      if (data) {
        data.filter(d => d.kpi_key === def.key).forEach(d => {
          months[d.month - 1] = d.target_value;
        });
      }
      return { kpi_key: def.key, months };
    });

    setRows(newRows);
    setDirty(false);
    setLoading(false);
  }

  function updateCell(kpiIdx: number, monthIdx: number, value: string) {
    setRows(prev => {
      const next = [...prev];
      next[kpiIdx] = {
        ...next[kpiIdx],
        months: next[kpiIdx].months.map((v, i) =>
          i === monthIdx ? (value === '' ? null : parseFloat(value.replace(',', '.')) || null) : v
        ),
      };
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);

    // Collect all non-null cells
    const upserts: any[] = [];
    rows.forEach(row => {
      row.months.forEach((val, monthIdx) => {
        if (val !== null) {
          upserts.push({
            hotel_id: targetHotel || null,
            kpi_key: row.kpi_key,
            year,
            month: monthIdx + 1,
            target_value: val,
            updated_at: new Date().toISOString(),
          });
        }
      });
    });

    // Delete existing for this hotel/year then insert
    let delQ = supabase.from('kpi_targets').delete().eq('year', year);
    if (targetHotel) {
      delQ = delQ.eq('hotel_id', targetHotel);
    } else {
      delQ = delQ.is('hotel_id', null);
    }
    await delQ;

    if (upserts.length) {
      await supabase.from('kpi_targets').insert(upserts);
    }

    setDirty(false);
    setSaving(false);
  }

  // Copy from previous year
  async function copyFromPrevYear() {
    let q = supabase.from('kpi_targets').select('*').eq('year', year - 1);
    if (targetHotel) q = q.eq('hotel_id', targetHotel);
    else q = q.is('hotel_id', null);

    const { data } = await q;
    if (!data?.length) return;

    setRows(prev =>
      prev.map(row => {
        const months = [...row.months];
        data.filter(d => d.kpi_key === row.kpi_key).forEach(d => {
          if (months[d.month - 1] === null) {
            months[d.month - 1] = d.target_value;
          }
        });
        return { ...row, months };
      }),
    );
    setDirty(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link to="/directors" className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <Target className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Metas KPI</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Defina metas mensais por indicador</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyFromPrevYear} className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
            Copiar de {year - 1}
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Hotel selector */}
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-500" />
          <select
            value={targetHotel ?? '__network__'}
            onChange={e => setTargetHotel(e.target.value === '__network__' ? null : e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-2"
          >
            <option value="__network__">Rede (consolidado)</option>
            {hotels.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>

        {/* Year nav */}
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <button onClick={() => setYear(y => y - 1)} className="p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-l-lg">
            <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          <span className="px-3 text-sm font-semibold text-gray-900 dark:text-white">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-r-lg">
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-700/50 z-10 min-w-[160px]">
                    KPI
                  </th>
                  {MONTHS.map((m, i) => (
                    <th key={i} className="text-center px-2 py-3 font-medium text-gray-600 dark:text-gray-400 min-w-[80px]">
                      {m}
                    </th>
                  ))}
                  <th className="text-center px-3 py-3 font-medium text-gray-600 dark:text-gray-400 min-w-[90px]">
                    Média
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {rows.map((row, kpiIdx) => {
                  const def = KPI_DEFS.find(d => d.key === row.kpi_key)!;
                  const filled = row.months.filter(v => v !== null) as number[];
                  const avg = filled.length ? (filled.reduce((s, v) => s + v, 0) / filled.length) : null;

                  return (
                    <tr key={row.kpi_key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-2 sticky left-0 bg-white dark:bg-gray-800 z-10">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: def.color }} />
                          <span className="font-medium text-gray-900 dark:text-white">{def.label}</span>
                          {def.unit && <span className="text-xs text-gray-400">({def.unit})</span>}
                        </div>
                      </td>
                      {row.months.map((val, monthIdx) => (
                        <td key={monthIdx} className="px-1 py-1 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={val !== null ? val : ''}
                            onChange={e => updateCell(kpiIdx, monthIdx, e.target.value)}
                            placeholder="—"
                            className="w-full text-center text-sm p-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-500 focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {avg !== null ? avg.toFixed(1) : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
        {KPI_DEFS.map(def => (
          <span key={def.key} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: def.color }} />
            {def.label} {def.unit && `(${def.unit})`}
          </span>
        ))}
      </div>
    </div>
  );
}
