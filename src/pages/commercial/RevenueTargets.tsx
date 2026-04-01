// src/pages/commercial/RevenueTargets.tsx
// Metas mensais de receita, ocupação e ADR por hotel

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import {
  Target, Loader2, Save, ChevronLeft, ChevronRight, DollarSign, Percent, TrendingUp,
} from 'lucide-react';

interface RevenueTarget {
  id?: string;
  hotel_id: string;
  year: number;
  month: number;
  target_occupancy: number | null;
  target_adr: number | null;
  target_revenue: number | null;
}

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function RevenueTargets() {
  const { selectedHotel } = useHotel();
  const [year, setYear] = useState(new Date().getFullYear());
  const [targets, setTargets] = useState<RevenueTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (selectedHotel?.id) loadTargets();
  }, [selectedHotel?.id, year]);

  async function loadTargets() {
    setLoading(true);
    const { data } = await supabase
      .from('revenue_targets')
      .select('*')
      .eq('hotel_id', selectedHotel!.id)
      .eq('year', year)
      .order('month');

    // Fill all 12 months
    const existing = data || [];
    const full: RevenueTarget[] = [];
    for (let m = 1; m <= 12; m++) {
      const found = existing.find(t => t.month === m);
      full.push(found || {
        hotel_id: selectedHotel!.id,
        year,
        month: m,
        target_occupancy: null,
        target_adr: null,
        target_revenue: null,
      });
    }
    setTargets(full);
    setEdited(false);
    setLoading(false);
  }

  function updateTarget(month: number, field: keyof RevenueTarget, value: string) {
    setTargets(prev => prev.map(t =>
      t.month === month ? { ...t, [field]: value ? parseFloat(value) : null } : t
    ));
    setEdited(true);
  }

  async function saveAll() {
    if (!selectedHotel) return;
    setSaving(true);

    for (const t of targets) {
      if (t.target_occupancy === null && t.target_adr === null && t.target_revenue === null) {
        if (t.id) {
          await supabase.from('revenue_targets').delete().eq('id', t.id);
        }
        continue;
      }

      if (t.id) {
        await supabase.from('revenue_targets').update({
          target_occupancy: t.target_occupancy,
          target_adr: t.target_adr,
          target_revenue: t.target_revenue,
        }).eq('id', t.id);
      } else {
        await supabase.from('revenue_targets').insert({
          hotel_id: selectedHotel.id,
          year: t.year,
          month: t.month,
          target_occupancy: t.target_occupancy,
          target_adr: t.target_adr,
          target_revenue: t.target_revenue,
        });
      }
    }

    setSaving(false);
    loadTargets();
  }

  // Summary
  const totalRevenue = targets.reduce((s, t) => s + (t.target_revenue || 0), 0);
  const avgOccupancy = targets.filter(t => t.target_occupancy).length > 0
    ? (targets.reduce((s, t) => s + (t.target_occupancy || 0), 0) / targets.filter(t => t.target_occupancy).length).toFixed(1)
    : '—';
  const avgAdr = targets.filter(t => t.target_adr).length > 0
    ? (targets.reduce((s, t) => s + (t.target_adr || 0), 0) / targets.filter(t => t.target_adr).length).toFixed(0)
    : '—';

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Metas de Receita</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Metas mensais de ocupação, ADR e receita</p>
          </div>
        </div>
        <button onClick={saveAll} disabled={saving || !edited}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
      </div>

      {/* Year selector */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button onClick={() => setYear(y => y - 1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{year}</span>
        <button onClick={() => setYear(y => y + 1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <DollarSign className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">R$ {totalRevenue.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-gray-500">Meta Receita Anual</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <Percent className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">{avgOccupancy}%</p>
          <p className="text-xs text-gray-500">Ocupação Média</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <TrendingUp className="w-5 h-5 text-violet-500 mx-auto mb-1" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">R$ {avgAdr}</p>
          <p className="text-xs text-gray-500">ADR Médio</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 w-24">Mês</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Ocupação (%)</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">ADR (R$)</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400">Receita (R$)</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.month} className="border-b border-gray-100 dark:border-gray-700">
                <td className="px-4 py-2 font-medium text-gray-800 dark:text-white">
                  {MONTH_NAMES[t.month - 1]}
                </td>
                <td className="px-4 py-2">
                  <input type="number" step="0.1" min="0" max="100"
                    value={t.target_occupancy ?? ''}
                    onChange={e => updateTarget(t.month, 'target_occupancy', e.target.value)}
                    placeholder="—"
                    className="w-full text-center px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </td>
                <td className="px-4 py-2">
                  <input type="number" step="1" min="0"
                    value={t.target_adr ?? ''}
                    onChange={e => updateTarget(t.month, 'target_adr', e.target.value)}
                    placeholder="—"
                    className="w-full text-center px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </td>
                <td className="px-4 py-2">
                  <input type="number" step="100" min="0"
                    value={t.target_revenue ?? ''}
                    onChange={e => updateTarget(t.month, 'target_revenue', e.target.value)}
                    placeholder="—"
                    className="w-full text-center px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
