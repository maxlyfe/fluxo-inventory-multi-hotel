// src/pages/pdv/PDVHistory.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  RotateCcw, Search, Filter, ShoppingCart, Package,
} from 'lucide-react';

import {
  getSalesHistory,
  retryErbonPosting,
  getSectorsForPDV,
  PDVSaleHistory,
  PDVSaleItem,
  PDVSectorDetails,
  SalesHistoryFilters,
} from '../../lib/pdvService';
import { supabase } from '../../lib/supabase';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ──────────────────────────────────────────────────────────────

const PDVHistory: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  // ── Filters state ──────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [selectedSectorId, setSelectedSectorId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'posted' | 'failed'>('all');

  // ── Data state ─────────────────────────────────────────────────────────
  const [sales, setSales] = useState<PDVSaleHistory[]>([]);
  const [sectors, setSectors] = useState<PDVSectorDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, PDVSaleItem[]>>({});
  const [loadingItems, setLoadingItems] = useState<Record<string, boolean>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // ── Load sectors on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedHotel) return;
    getSectorsForPDV(selectedHotel.id)
      .then(s => setSectors(s))
      .catch(err => addNotification('error', `Erro ao carregar setores: ${err.message}`));
  }, [selectedHotel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load history ───────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!selectedHotel) return;
    setLoading(true);
    try {
      const filters: SalesHistoryFilters = {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sectorId: selectedSectorId || undefined,
        erbonFailed: statusFilter === 'failed' ? true : statusFilter === 'posted' ? false : undefined,
      };
      const data = await getSalesHistory(selectedHotel.id, filters);
      setSales(data);
      // Clear expanded state when reloading
      setExpandedId(null);
      setExpandedItems({});
    } catch (err: any) {
      addNotification('error', `Erro ao carregar histórico: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, startDate, endDate, selectedSectorId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    loadHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Expand row & lazy-load items ───────────────────────────────────────
  async function toggleExpand(saleId: string) {
    if (expandedId === saleId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(saleId);

    if (expandedItems[saleId]) return; // already loaded

    setLoadingItems(prev => ({ ...prev, [saleId]: true }));
    try {
      const { data, error } = await supabase
        .from('pdv_sale_items')
        .select('*')
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setExpandedItems(prev => ({ ...prev, [saleId]: (data as PDVSaleItem[]) || [] }));
    } catch (err: any) {
      addNotification('error', `Erro ao carregar itens: ${err.message}`);
    } finally {
      setLoadingItems(prev => ({ ...prev, [saleId]: false }));
    }
  }

  // ── Retry Erbon for a sale ─────────────────────────────────────────────
  async function handleRetry(saleId: string) {
    if (!selectedHotel) return;
    setRetryingId(saleId);
    try {
      await retryErbonPosting(saleId, selectedHotel.id);
      addNotification('success', 'Reenvio ao PMS realizado com sucesso');
      // Refresh only the affected row by reloading the list
      await loadHistory();
    } catch (err: any) {
      addNotification('error', `Erro no reenvio: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <History className="w-6 h-6 text-amber-500" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Histórico PDV
            </h1>
            {selectedHotel && (
              <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
                — {selectedHotel.name}
              </span>
            )}
            {sales.length > 0 && !loading && (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold">
                {sales.length} {sales.length === 1 ? 'venda' : 'vendas'}
              </span>
            )}
          </div>
          <button
            onClick={() => navigate('/pdv')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">Ir para PDV</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Filters bar */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Filtros</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Start date */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                Data inicial
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {/* End date */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                Data final
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {/* Sector */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                Setor
              </label>
              <select
                value={selectedSectorId}
                onChange={e => setSelectedSectorId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Todos os setores</option>
                {sectors.map(s => (
                  <option key={s.sector_id} value={s.sector_id}>
                    {s.sector_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                Status PMS
              </label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | 'posted' | 'failed')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">Todos</option>
                <option value="posted">Lançado no PMS</option>
                <option value="failed">Falhou no PMS</option>
              </select>
            </div>

            {/* Search button */}
            <div className="flex items-end">
              <button
                onClick={loadHistory}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 transition-all"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Buscar
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
              <Package className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhuma venda encontrada com os filtros selecionados</p>
              <p className="text-xs mt-1 text-gray-400">Tente ajustar o período ou os filtros</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Data/Hora
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      UH
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Hóspede
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Setor
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Itens
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Total
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      PMS
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Operador
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sales.map(sale => {
                    const isExpanded = expandedId === sale.id;
                    const items = expandedItems[sale.id];
                    const isLoadingItems = loadingItems[sale.id];
                    const isRetrying = retryingId === sale.id;

                    return (
                      <React.Fragment key={sale.id}>
                        {/* Main row */}
                        <tr
                          className={`transition-colors
                            ${isExpanded
                              ? 'bg-amber-50 dark:bg-amber-900/10'
                              : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/30'
                            }`}
                        >
                          {/* Date/Time */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-medium text-gray-900 dark:text-white text-xs">
                              {fmtDateTime(sale.sale_date || sale.created_at)}
                            </p>
                          </td>

                          {/* UH */}
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold">
                              {sale.room_description}
                            </span>
                          </td>

                          {/* Guest */}
                          <td className="px-4 py-3">
                            <p className="text-sm text-gray-900 dark:text-white font-medium truncate max-w-[140px]">
                              {sale.guest_name}
                            </p>
                            <p className="text-xs text-gray-400">#{sale.booking_number}</p>
                          </td>

                          {/* Sector */}
                          <td className="px-4 py-3">
                            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              {sale.sector_name}
                            </p>
                          </td>

                          {/* Item count */}
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {sale.items?.length ?? '—'}
                            </span>
                          </td>

                          {/* Total */}
                          <td className="px-4 py-3 text-right">
                            <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
                              {fmtBRL(sale.total_amount)}
                            </span>
                          </td>

                          {/* PMS status */}
                          <td className="px-4 py-3 text-center">
                            {sale.erbon_posted ? (
                              <CheckCircle
                                className="w-5 h-5 text-green-500 mx-auto"
                                title="Lançado no PMS"
                              />
                            ) : (
                              <div className="flex items-center justify-center">
                                <AlertTriangle
                                  className="w-5 h-5 text-amber-500"
                                  title={sale.erbon_post_error ?? 'Falhou no PMS'}
                                />
                              </div>
                            )}
                          </td>

                          {/* Operator */}
                          <td className="px-4 py-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">
                              {sale.operator_name || '—'}
                            </p>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Retry button */}
                              {!sale.erbon_posted && (
                                <button
                                  onClick={() => handleRetry(sale.id)}
                                  disabled={isRetrying}
                                  title="Retentar PMS"
                                  className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
                                >
                                  {isRetrying ? (
                                    <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <RotateCcw className="w-4 h-4" />
                                  )}
                                </button>
                              )}

                              {/* Expand toggle */}
                              <button
                                onClick={() => toggleExpand(sale.id)}
                                title={isExpanded ? 'Recolher' : 'Ver itens'}
                                className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded row — items */}
                        {isExpanded && (
                          <tr className="bg-amber-50/50 dark:bg-amber-900/5">
                            <td colSpan={9} className="px-6 py-4">
                              {/* Erbon error message */}
                              {!sale.erbon_posted && sale.erbon_post_error && (
                                <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                  <p className="text-xs text-red-600 dark:text-red-400">
                                    <span className="font-semibold">Erro PMS: </span>
                                    {sale.erbon_post_error}
                                  </p>
                                </div>
                              )}

                              {isLoadingItems ? (
                                <div className="flex items-center justify-center py-6">
                                  <div className="w-6 h-6 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : items && items.length > 0 ? (
                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead className="bg-gray-100 dark:bg-gray-700">
                                      <tr>
                                        <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Produto</th>
                                        <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Qtd</th>
                                        <th className="text-right px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Preço Unit.</th>
                                        <th className="text-right px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Total</th>
                                        <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">PMS</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                                      {items.map(item => (
                                        <tr key={item.id}>
                                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                                            {item.product_name}
                                          </td>
                                          <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                                            {item.quantity}
                                          </td>
                                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                                            {fmtBRL(item.unit_price)}
                                          </td>
                                          <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">
                                            {fmtBRL(item.total_price)}
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            {item.erbon_posted ? (
                                              <CheckCircle
                                                className="w-3.5 h-3.5 text-green-500 mx-auto"
                                                title="Lançado no PMS"
                                              />
                                            ) : (
                                              <AlertTriangle
                                                className="w-3.5 h-3.5 text-amber-500 mx-auto"
                                                title={item.erbon_post_error ?? 'Não lançado'}
                                              />
                                            )}
                                          </td>
                                        </tr>
                                      ))}

                                      {/* Total row */}
                                      <tr className="bg-gray-50 dark:bg-gray-700/50 font-bold">
                                        <td className="px-3 py-2 text-gray-900 dark:text-white" colSpan={3}>
                                          Total
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                                          {fmtBRL(items.reduce((s, i) => s + i.total_price, 0))}
                                        </td>
                                        <td />
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 text-center py-4">
                                  Nenhum item encontrado
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary footer */}
        {sales.length > 0 && !loading && (
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 px-1">
            <span>
              {sales.length} {sales.length === 1 ? 'venda' : 'vendas'} encontrada{sales.length !== 1 ? 's' : ''}
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              Total: {fmtBRL(sales.reduce((s, sale) => s + sale.total_amount, 0))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDVHistory;
