import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Loader2, AlertTriangle, Download } from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { supabase } from '../../lib/supabase';
import { fmtBRL, fmtDate, PeriodFilter, defaultPeriod, Period } from '../../components/financial/shared';
import * as XLSX from 'xlsx';

interface Balance {
  id: string;
  transaction_type: 'credit' | 'debit';
  amount: number;
  reason: string;
  reference_type: string;
  balance: number;
  created_at: string;
}

export default function MovimentacoesPage() {
  const { selectedHotel } = useHotel();
  const [items, setItems] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  const hotelId = selectedHotel?.id;

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true); setError('');
    try {
      const { data, error: e } = await supabase
        .from('hotel_balances')
        .select('*')
        .eq('hotel_id', hotelId)
        .gte('created_at', period.from + 'T00:00:00')
        .lte('created_at', period.to + 'T23:59:59')
        .order('created_at', { ascending: false });
      if (e) throw e;
      setItems(data ?? []);
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [hotelId, period]);

  useEffect(() => { load(); }, [load]);

  const handleExport = () => {
    const rows = items.map(b => ({
      Data: fmtDate(b.created_at.slice(0, 10)),
      Tipo: b.transaction_type === 'credit' ? 'Crédito' : 'Débito',
      Valor: Number(b.amount),
      Motivo: b.reason,
      Referência: b.reference_type,
      Saldo: Number(b.balance),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimentações');
    XLSX.writeFile(wb, `movimentacoes_${period.from}_${period.to}.xlsx`);
  };

  if (!hotelId) return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="h-8 w-8 text-indigo-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Movimentações</h1>
        </div>
        <div className="flex items-center gap-3">
          <PeriodFilter period={period} onChange={setPeriod} />
          <button onClick={handleExport} disabled={items.length === 0} className="flex items-center gap-2 px-3 py-2 text-sm border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Motivo</th>
                <th className="text-left px-4 py-3">Referência</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-right px-4 py-3">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">Nenhuma movimentação no período.</td></tr>
              ) : items.map(b => (
                <tr key={b.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDate(b.created_at.slice(0, 10))}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      b.transaction_type === 'credit'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {b.transaction_type === 'credit' ? 'Crédito' : 'Débito'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{b.reason}</td>
                  <td className="px-4 py-3 text-gray-500">{b.reference_type}</td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                    b.transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {b.transaction_type === 'credit' ? '+' : '-'}{fmtBRL(Number(b.amount))}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmtBRL(Number(b.balance))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
