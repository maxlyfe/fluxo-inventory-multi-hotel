import React, { useState, useEffect, useCallback } from 'react';
import { useHotel } from '../context/HotelContext';
import {
  DollarSign, Loader2, AlertTriangle, TrendingDown, TrendingUp, Wallet, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cashflowService, FinanceSummary, CashflowPoint, SectorSpend } from '../lib/cashflowService';
import { fmtBRL, PeriodFilter, defaultPeriod, Period, SummaryCard } from '../components/financial/shared';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  const d = new Date(Number(y), Number(mo) - 1);
  return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function SpendTable({ groups, unclassified, total }: { groups: SectorSpend[]; unclassified: number; total: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b dark:border-gray-700">
        <h3 className="font-semibold text-gray-800 dark:text-white">Gastos por Setor / Plano de Contas</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-3">Categoria</th>
            <th className="text-right px-4 py-3">Valor</th>
            <th className="text-right px-4 py-3">%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <React.Fragment key={g.accountId}>
              <tr className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onClick={() => toggle(g.accountId)}>
                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1">
                  {expanded.has(g.accountId) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  {g.accountName}
                </td>
                <td className="px-4 py-3 text-right font-semibold">{fmtBRL(g.total)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{total > 0 ? ((g.total / total) * 100).toFixed(1) : 0}%</td>
              </tr>
              {expanded.has(g.accountId) && g.subs.map(s => (
                <tr key={s.subId} className="border-t dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
                  <td className="px-4 py-2 pl-10 text-gray-600 dark:text-gray-400">{s.subName}</td>
                  <td className="px-4 py-2 text-right">{fmtBRL(s.total)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{total > 0 ? ((s.total / total) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          {unclassified > 0 && (
            <tr className="border-t dark:border-gray-700">
              <td className="px-4 py-3 text-gray-500 italic">Sem classificação</td>
              <td className="px-4 py-3 text-right">{fmtBRL(unclassified)}</td>
              <td className="px-4 py-3 text-right text-gray-400">{total > 0 ? ((unclassified / total) * 100).toFixed(1) : 0}%</td>
            </tr>
          )}
          <tr className="border-t-2 dark:border-gray-600 font-bold">
            <td className="px-4 py-3 text-gray-800 dark:text-white">Total</td>
            <td className="px-4 py-3 text-right">{fmtBRL(total)}</td>
            <td className="px-4 py-3 text-right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const FinancialManagement = () => {
  const { selectedHotel } = useHotel();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [projection, setProjection] = useState<CashflowPoint[]>([]);
  const [spend, setSpend] = useState<{ groups: SectorSpend[]; unclassified: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 5, 0);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });

  const hotelId = selectedHotel?.id;

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true); setError('');
    try {
      const [s, p, sp] = await Promise.all([
        cashflowService.summary(hotelId),
        cashflowService.projection(hotelId, period.from, period.to),
        cashflowService.spendBySector(hotelId, period.from, period.to),
      ]);
      setSummary(s); setProjection(p); setSpend(sp);
    } catch (err: any) { setError(err.message ?? 'Erro ao carregar'); }
    finally { setLoading(false); }
  }, [hotelId, period]);

  useEffect(() => { load(); }, [load]);

  if (!hotelId) return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-emerald-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Painel Financeiro</h1>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {loading && !summary ? (
        <div className="py-20 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>
      ) : summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            <SummaryCard label="A pagar (mês)" value={fmtBRL(summary.apOpenMonth)} color="text-red-600 dark:text-red-400" icon={<TrendingDown className="w-5 h-5 text-red-400" />} />
            <SummaryCard label="A receber (mês)" value={fmtBRL(summary.arOpenMonth)} color="text-green-600 dark:text-green-400" icon={<TrendingUp className="w-5 h-5 text-green-400" />} />
            <SummaryCard label="AP vencidos" value={fmtBRL(summary.apOverdue)} color="text-red-700 dark:text-red-300" />
            <SummaryCard label="AR atrasados" value={fmtBRL(summary.arOverdue)} color="text-amber-600 dark:text-amber-400" />
            <SummaryCard label="Saldo projetado (90d)" value={fmtBRL(summary.projectedBalance)} color={summary.projectedBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} icon={<Wallet className="w-5 h-5 text-emerald-400" />} />
          </div>

          {projection.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-5 mb-8">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Fluxo de Caixa Projetado</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={projection.map(p => ({ ...p, name: monthLabel(p.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={v => fmtBRL(v).replace('R$ ', '')} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Legend />
                  <Bar dataKey="inflow" name="Entradas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outflow" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {spend && <SpendTable groups={spend.groups} unclassified={spend.unclassified} total={spend.total} />}
        </>
      )}
    </div>
  );
};

export default FinancialManagement;
