// src/pages/TransferHistory.tsx
// Histórico de transferências entre hotéis com tracking inteligente de dívidas

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import {
  ArrowLeftRight, ChevronDown, ChevronRight, Package,
  TrendingUp, TrendingDown, Scale, Building2, Search,
  Filter, ArrowUpRight, ArrowDownLeft, CheckCircle2,
  AlertCircle, Clock, X, HandCoins, Loader2, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Transfer {
  id: string;
  source_hotel_id: string;
  destination_hotel_id: string;
  product_id: string;
  quantity: number;
  unit_value: number | null;
  status: string; // pending | completed | cancelled
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  source_hotel: { id: string; name: string } | null;
  destination_hotel: { id: string; name: string } | null;
  product: { id: string; name: string; image_url: string | null; category: string } | null;
}

interface HotelPairSummary {
  otherHotelId: string;
  otherHotelName: string;
  products: ProductDebtSummary[];
  totalSent: number;
  totalReceived: number;
  netItems: number; // positive = they owe us (sent more), negative = we owe them (received more)
  totalValueSent: number;
  totalValueReceived: number;
}

interface ProductDebtSummary {
  productId: string;
  productName: string;
  productImage: string | null;
  productCategory: string;
  totalSent: number;
  totalReceived: number;
  net: number; // positive = sent more (they owe us), negative = received more (we owe them)
  transfers: TransferLine[];
}

interface TransferLine {
  id: string;
  date: string;
  quantity: number;
  direction: 'sent' | 'received';
  otherHotelName: string;
  unitValue: number | null;
  status: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const TransferHistory: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'cancelled'>('completed');
  const [expandedHotels, setExpandedHotels] = useState<Set<string>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [forgiveConfirm, setForgiveConfirm] = useState<{
    hotelId: string;
    hotelName: string;
    products: (ProductDebtSummary & { cancelQty: string })[];
  } | null>(null);
  const [forgiving, setForgiving] = useState(false);

  // ── Fetch transfers ──────────────────────────────────────────────────────
  const fetchTransfers = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    try {
      // Transfers where this hotel is source OR destination
      const { data: sentData, error: sentErr } = await supabase
        .from('hotel_transfers')
        .select(`
          id, source_hotel_id, destination_hotel_id, product_id,
          quantity, unit_value, status, notes, created_at, completed_at,
          source_hotel:hotels!hotel_transfers_source_hotel_id_fkey(id, name),
          destination_hotel:hotels!hotel_transfers_destination_hotel_id_fkey(id, name),
          product:products!hotel_transfers_product_id_fkey(id, name, image_url, category)
        `)
        .or(`source_hotel_id.eq.${selectedHotel.id},destination_hotel_id.eq.${selectedHotel.id}`)
        .order('created_at', { ascending: false });

      if (sentErr) throw sentErr;
      setTransfers((sentData || []) as unknown as Transfer[]);
    } catch (err: any) {
      console.error('Erro ao buscar transferências:', err);
      addNotification('Erro ao carregar histórico de transferências.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  // ── Build summaries ──────────────────────────────────────────────────────
  const hotelPairs = useMemo(() => {
    if (!selectedHotel?.id) return [];

    // Filtro de busca (aplicado a tudo)
    const matchesSearch = (t: Transfer) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const productName = t.product?.name?.toLowerCase() || '';
      const sourceName = t.source_hotel?.name?.toLowerCase() || '';
      const destName = t.destination_hotel?.name?.toLowerCase() || '';
      return productName.includes(term) || sourceName.includes(term) || destName.includes(term);
    };

    // Group by other hotel
    const pairMap = new Map<string, {
      otherHotelId: string;
      otherHotelName: string;
      productMap: Map<string, ProductDebtSummary>;
    }>();

    for (const t of transfers) {
      if (!matchesSearch(t)) continue;

      const isSent = t.source_hotel_id === selectedHotel.id;
      const otherHotelId = isSent ? t.destination_hotel_id : t.source_hotel_id;
      const otherHotelName = isSent
        ? (t.destination_hotel?.name || 'Hotel desconhecido')
        : (t.source_hotel?.name || 'Hotel desconhecido');

      if (!pairMap.has(otherHotelId)) {
        pairMap.set(otherHotelId, {
          otherHotelId,
          otherHotelName,
          productMap: new Map(),
        });
      }

      const pair = pairMap.get(otherHotelId)!;
      const productId = t.product_id;
      const productName = t.product?.name || 'Produto desconhecido';

      if (!pair.productMap.has(productId)) {
        pair.productMap.set(productId, {
          productId,
          productName,
          productImage: t.product?.image_url || null,
          productCategory: t.product?.category || '',
          totalSent: 0,
          totalReceived: 0,
          net: 0,
          transfers: [],
        });
      }

      const ps = pair.productMap.get(productId)!;

      // Dívida: sempre conta completed + cancelled (independente do filtro visual)
      if (t.status === 'completed' || t.status === 'cancelled') {
        if (isSent) {
          ps.totalSent += t.quantity;
        } else {
          ps.totalReceived += t.quantity;
        }
      }

      // Linhas de transferência: respeita o filtro de status para exibição
      if (statusFilter === 'all' || t.status === statusFilter) {
        ps.transfers.push({
          id: t.id,
          date: t.created_at,
          quantity: t.quantity,
          direction: isSent ? 'sent' : 'received',
          otherHotelName,
          unitValue: t.unit_value,
          status: t.status,
          notes: t.notes,
        });
      }
    }

    // Calculate nets and build final array
    const results: HotelPairSummary[] = [];
    for (const [, pair] of pairMap) {
      const products: ProductDebtSummary[] = [];
      let totalSent = 0;
      let totalReceived = 0;
      let totalValueSent = 0;
      let totalValueReceived = 0;

      for (const [, ps] of pair.productMap) {
        ps.net = ps.totalSent - ps.totalReceived; // positive = they owe us
        ps.transfers.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        products.push(ps);
        totalSent += ps.totalSent;
        totalReceived += ps.totalReceived;

        // Valores monetários: usa todos (completed + cancelled)
        for (const tl of ps.transfers) {
          const val = (tl.unitValue || 0) * tl.quantity;
          if (tl.direction === 'sent') totalValueSent += val;
          else totalValueReceived += val;
        }
      }

      // Só mostra pares que têm transferências visíveis no filtro atual
      const hasVisibleTransfers = products.some(p => p.transfers.length > 0);
      if (!hasVisibleTransfers) continue;

      products.sort((a, b) => a.productName.localeCompare(b.productName));

      results.push({
        otherHotelId: pair.otherHotelId,
        otherHotelName: pair.otherHotelName,
        products,
        totalSent,
        totalReceived,
        netItems: totalSent - totalReceived, // positive = they owe us
        totalValueSent,
        totalValueReceived,
      });
    }

    results.sort((a, b) => a.otherHotelName.localeCompare(b.otherHotelName));
    return results;
  }, [transfers, selectedHotel, statusFilter, searchTerm]);

  // ── Global stats ─────────────────────────────────────────────────────────
  const globalStats = useMemo(() => {
    let totalSent = 0;
    let totalReceived = 0;
    let totalValueSent = 0;
    let totalValueReceived = 0;

    for (const pair of hotelPairs) {
      totalSent += pair.totalSent;
      totalReceived += pair.totalReceived;
      totalValueSent += pair.totalValueSent;
      totalValueReceived += pair.totalValueReceived;
    }

    return { totalSent, totalReceived, totalValueSent, totalValueReceived, net: totalSent - totalReceived };
  }, [hotelPairs]);

  // ── Cancelar dívida ─────────────────────────────────────────────────────
  const openForgiveModal = (hotelId: string, hotelName: string, products: ProductDebtSummary[]) => {
    setForgiveConfirm({
      hotelId,
      hotelName,
      products: products
        .filter(p => p.net !== 0)
        .map(p => ({ ...p, cancelQty: String(Math.abs(p.net)) })),
    });
  };

  const handleForgiveQtyChange = (productId: string, value: string) => {
    if (!forgiveConfirm) return;
    setForgiveConfirm({
      ...forgiveConfirm,
      products: forgiveConfirm.products.map(p =>
        p.productId === productId ? { ...p, cancelQty: value } : p
      ),
    });
  };

  const handleForgiveDebt = async () => {
    if (!forgiveConfirm || !selectedHotel?.id) return;

    const itemsToCancel = forgiveConfirm.products
      .map(p => ({ ...p, qty: parseInt(p.cancelQty) || 0 }))
      .filter(p => p.qty > 0);

    if (itemsToCancel.length === 0) {
      addNotification('Informe ao menos uma quantidade para cancelar.', 'error');
      return;
    }

    // Validar que não excede a dívida
    const overLimit = itemsToCancel.find(p => p.qty > Math.abs(p.net));
    if (overLimit) {
      addNotification(
        `"${overLimit.productName}": quantidade (${overLimit.qty}) excede a dívida (${Math.abs(overLimit.net)}).`,
        'error'
      );
      return;
    }

    setForgiving(true);
    try {
      for (const ps of itemsToCancel) {
        // Se net > 0 (devem-nos), criamos "recebimento virtual"
        // Se net < 0 (devemos), criamos "envio virtual"
        const sourceId = ps.net > 0 ? forgiveConfirm.hotelId : selectedHotel.id;
        const destId = ps.net > 0 ? selectedHotel.id : forgiveConfirm.hotelId;

        const { error: insertErr } = await supabase
          .from('hotel_transfers')
          .insert({
            source_hotel_id: sourceId,
            destination_hotel_id: destId,
            product_id: ps.productId,
            quantity: ps.qty,
            unit_value: null,
            status: 'cancelled',
            notes: 'Dívida cancelada',
            completed_at: new Date().toISOString(),
          });

        if (insertErr) throw insertErr;
      }

      addNotification(`Dívida de ${itemsToCancel.length} item(s) cancelada com sucesso!`, 'success');
      setForgiveConfirm(null);
      fetchTransfers();
    } catch (err: any) {
      console.error('Erro ao cancelar dívida:', err);
      addNotification('Erro ao cancelar dívida: ' + (err.message || 'Erro desconhecido'), 'error');
    } finally {
      setForgiving(false);
    }
  };

  // ── Toggle helpers ───────────────────────────────────────────────────────
  const toggleHotel = (hotelId: string) => {
    setExpandedHotels(prev => {
      const next = new Set(prev);
      if (next.has(hotelId)) next.delete(hotelId);
      else next.add(hotelId);
      return next;
    });
  };

  const toggleProduct = (key: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Debt status helpers ──────────────────────────────────────────────────
  const getDebtBadge = (net: number) => {
    if (net === 0) return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
        <CheckCircle2 className="w-3.5 h-3.5" /> Equilibrado
      </span>
    );
    if (net > 0) return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
        <TrendingUp className="w-3.5 h-3.5" /> Devem {net}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
        <TrendingDown className="w-3.5 h-3.5" /> Devendo {Math.abs(net)}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 className="w-3 h-3" /> Concluída
        </span>
      );
      case 'pending': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
          <Clock className="w-3 h-3" /> Pendente
        </span>
      );
      case 'cancelled': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <X className="w-3 h-3" /> Cancelada
        </span>
      );
      default: return null;
    }
  };

  // ── Loading / no hotel ───────────────────────────────────────────────────
  if (!selectedHotel) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <Building2 className="h-12 w-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Nenhum hotel selecionado</h2>
          <button onClick={() => navigate('/select-hotel')} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Selecionar Hotel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
            <ArrowLeftRight className="h-8 w-8 text-orange-500" />
            Histórico de Transferências
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {selectedHotel.name} — Rastreio inteligente de transferências e dívidas
          </p>
        </div>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight className="w-5 h-5 text-red-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Enviados</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-white">{globalStats.totalSent}</p>
          {globalStats.totalValueSent > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {globalStats.totalValueSent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownLeft className="w-5 h-5 text-green-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Recebidos</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-white">{globalStats.totalReceived}</p>
          {globalStats.totalValueReceived > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {globalStats.totalValueReceived.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-5 h-5 text-blue-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Saldo</span>
          </div>
          <p className={`text-2xl font-bold ${globalStats.net > 0 ? 'text-green-600' : globalStats.net < 0 ? 'text-red-600' : 'text-gray-800 dark:text-white'}`}>
            {globalStats.net > 0 ? '+' : ''}{globalStats.net}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {globalStats.net > 0 ? 'Devem-nos' : globalStats.net < 0 ? 'Devendo' : 'Equilibrado'}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-5 h-5 text-purple-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hotéis</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-white">{hotelPairs.length}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Com transferências</p>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar por produto ou hotel..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'completed', 'pending', 'cancelled'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {s === 'all' ? 'Todas' : s === 'completed' ? 'Concluídas' : s === 'pending' ? 'Pendentes' : 'Canceladas'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500"></div>
        </div>
      )}

      {/* ── No data ─────────────────────────────────────────────────────────── */}
      {!loading && hotelPairs.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <ArrowLeftRight className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Nenhuma transferência encontrada
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            As transferências entre hotéis aparecerão aqui com rastreio automático de dívidas.
          </p>
        </div>
      )}

      {/* ── Hotel Pairs ─────────────────────────────────────────────────────── */}
      {!loading && hotelPairs.map(pair => {
        const isExpanded = expandedHotels.has(pair.otherHotelId);

        return (
          <div key={pair.otherHotelId} className="mb-4">
            {/* Hotel pair header */}
            <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleHotel(pair.otherHotelId)}>
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-purple-500" />
                    <span className="font-semibold text-gray-800 dark:text-white text-lg">
                      {pair.otherHotelName}
                    </span>
                  </div>
                  {getDebtBadge(pair.netItems)}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  {/* Botão cancelar dívida — só aparece se há dívida */}
                  {pair.netItems !== 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openForgiveModal(pair.otherHotelId, pair.otherHotelName, pair.products);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
                      title="Cancelar todas as dívidas com este hotel"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancelar dívida
                    </button>
                  )}
                  <div className="text-right">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Enviados</span>
                    <p className="font-semibold text-red-600 dark:text-red-400">{pair.totalSent} un</p>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Recebidos</span>
                    <p className="font-semibold text-green-600 dark:text-green-400">{pair.totalReceived} un</p>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Produtos</span>
                    <p className="font-semibold text-gray-700 dark:text-gray-300">{pair.products.length}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Products list */}
            {isExpanded && (
              <div className="mt-2 space-y-2 pl-4">
                {pair.products.map(ps => {
                  const productKey = `${pair.otherHotelId}-${ps.productId}`;
                  const isProductExpanded = expandedProducts.has(productKey);

                  return (
                    <div key={ps.productId} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                      {/* Product header */}
                      <button
                        onClick={() => toggleProduct(productKey)}
                        className="w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isProductExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                            <div className="w-8 h-8 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {ps.productImage ? (
                                <img src={ps.productImage} alt={ps.productName} className="w-full h-full object-cover" />
                              ) : (
                                <Package className="w-4 h-4 text-gray-400" />
                              )}
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-sm text-gray-800 dark:text-white">{ps.productName}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{ps.productCategory}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-red-500 font-medium">
                                <ArrowUpRight className="w-3 h-3 inline mr-0.5" />{ps.totalSent}
                              </span>
                              <span className="text-green-500 font-medium">
                                <ArrowDownLeft className="w-3 h-3 inline mr-0.5" />{ps.totalReceived}
                              </span>
                            </div>

                            {/* Net badge per product */}
                            {ps.net === 0 ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
                                Quitado
                              </span>
                            ) : ps.net > 0 ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                                Devem {ps.net}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
                                Devendo {Math.abs(ps.net)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Transfer details */}
                      {isProductExpanded && (
                        <div className="border-t border-gray-100 dark:border-gray-700">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 dark:bg-gray-700/50">
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Data</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Direção</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Qtd</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Valor Unit.</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {ps.transfers.map(tl => (
                                <tr key={tl.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                    {format(new Date(tl.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    {tl.direction === 'sent' ? (
                                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                                        <ArrowUpRight className="w-3.5 h-3.5" /> Enviado
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                                        <ArrowDownLeft className="w-3.5 h-3.5" /> Recebido
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-center font-semibold text-gray-800 dark:text-white">
                                    {tl.quantity}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                                    {tl.unitValue
                                      ? tl.unitValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                      : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-medium text-gray-700 dark:text-gray-300">
                                    {tl.unitValue
                                      ? (tl.unitValue * tl.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                      : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    {getStatusBadge(tl.status)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Product debt summary bar */}
                          <div className={`px-4 py-2.5 flex items-center justify-between text-sm ${
                            ps.net === 0
                              ? 'bg-green-50 dark:bg-green-900/20'
                              : ps.net > 0
                                ? 'bg-blue-50 dark:bg-blue-900/20'
                                : 'bg-orange-50 dark:bg-orange-900/20'
                          }`}>
                            <span className="font-medium text-gray-700 dark:text-gray-300">
                              Balanço deste item:
                            </span>
                            <span className={`font-bold ${
                              ps.net === 0
                                ? 'text-green-700 dark:text-green-400'
                                : ps.net > 0
                                  ? 'text-blue-700 dark:text-blue-400'
                                  : 'text-orange-700 dark:text-orange-400'
                            }`}>
                              {ps.net === 0
                                ? 'Dívida quitada'
                                : ps.net > 0
                                  ? `Devem ${ps.net} unidades`
                                  : `Devendo ${Math.abs(ps.net)} unidades`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {/* ── Modal cancelar dívida ────────────────────────────────────────── */}
      {forgiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-white">Cancelar dívida</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {forgiveConfirm.hotelName} — Escolha os itens e quantidades
                </p>
              </div>
            </div>

            {/* Lista de produtos com inputs */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {forgiveConfirm.products.map(p => {
                const maxQty = Math.abs(p.net);
                const currentQty = parseInt(p.cancelQty) || 0;
                const isOver = currentQty > maxQty;
                const isEmpty = currentQty === 0 || p.cancelQty === '' || p.cancelQty === '0';

                return (
                  <div
                    key={p.productId}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                      isOver
                        ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                        : isEmpty
                          ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40'
                          : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {p.productName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {p.net > 0 ? (
                          <span className="text-blue-600 dark:text-blue-400">Devem {maxQty}</span>
                        ) : (
                          <span className="text-orange-600 dark:text-orange-400">Devendo {maxQty}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <input
                        type="number"
                        min="0"
                        max={maxQty}
                        value={p.cancelQty}
                        onChange={e => handleForgiveQtyChange(p.productId, e.target.value)}
                        className={`w-20 px-2.5 py-1.5 text-sm text-center border rounded-lg focus:outline-none focus:ring-2 transition-all dark:bg-gray-700 dark:text-gray-100 ${
                          isOver
                            ? 'border-red-400 focus:ring-red-400'
                            : 'border-gray-300 dark:border-gray-600 focus:ring-red-500'
                        }`}
                      />
                      {isOver && (
                        <span className="text-[10px] text-red-500 font-medium">máx. {maxQty}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex gap-3">
              <button
                onClick={() => setForgiveConfirm(null)}
                disabled={forgiving}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={handleForgiveDebt}
                disabled={forgiving}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {forgiving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <X className="w-4 h-4" />
                    Confirmar cancelamento
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransferHistory;
