// src/pages/TransferHistory.tsx
// Histórico de transferências entre hotéis — redesign focado em auditoria + dívidas em R$
//
// 3 abas:
//   1. "Saldo R$"  (padrão) — Quanto cada hotel deve para o outro em R$
//   2. "Por Dia"            — Visão cronológica, agrupada por data (auditoria)
//   3. "Por Item"           — Histórico por produto com evolução de preço unitário
//
// Filtros globais: período (de–até), hotel parceiro, busca por item, status
// Export: Excel (.xlsx) respeitando os filtros aplicados

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useHotel } from '../context/HotelContext';
import { useNotification } from '../context/NotificationContext';
import * as XLSX from 'xlsx';
import {
  ArrowLeftRight, ChevronDown, ChevronRight, Package,
  TrendingUp, TrendingDown, Scale, Building2, Search,
  ArrowUpRight, ArrowDownLeft, CheckCircle2,
  Clock, X, HandCoins, Loader2, Calendar as CalendarIcon,
  Download, AlertTriangle, FileSpreadsheet,
} from 'lucide-react';
import { format, parseISO, startOfDay, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Transfer {
  id: string;
  source_hotel_id: string;
  destination_hotel_id: string;
  product_id: string;
  quantity: number;
  unit_value: number | null;
  status: 'pending' | 'completed' | 'cancelled' | string;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  source_hotel:      { id: string; name: string } | null;
  destination_hotel: { id: string; name: string } | null;
  product: { id: string; name: string; image_url: string | null; category: string } | null;
}

type Tab = 'balance' | 'byDay' | 'byItem';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const fmtBRLOrDash = (v: number | null) =>
  v == null ? '—' : fmtBRL(v);

const dateKey = (iso: string) => iso.slice(0, 10); // 'YYYY-MM-DD'

// Máscara dd/mm/aaaa
function maskDateBR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const parts: string[] = [];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join('/');
}
function brToISO(br: string): string | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = +d, mon = +mo, year = +y;
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  const dt = new Date(year, mon - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return null;
  return `${y}-${mo}-${d}`;
}
function isoToBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// ─── DateBR Input (dd/mm/aaaa + calendário) ─────────────────────────────────

function DateBRInput({ value, onChange, placeholder = 'dd/mm/aaaa' }: {
  value: string; onChange: (br: string) => void; placeholder?: string;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try { (el as any).showPicker?.(); } catch {}
    el.focus();
  };
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(maskDateBR(e.target.value))}
        placeholder={placeholder}
        maxLength={10}
        className="w-32 sm:w-36 pl-3 pr-9 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
      />
      <button
        type="button"
        onClick={openPicker}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        aria-label="Abrir calendário"
      >
        <CalendarIcon className="w-3.5 h-3.5" />
      </button>
      <input
        ref={dateRef}
        type="date"
        value={brToISO(value) || ''}
        onChange={e => onChange(e.target.value ? isoToBR(e.target.value) : '')}
        tabIndex={-1}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 opacity-0 pointer-events-none"
      />
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

const TransferHistory: React.FC = () => {
  const navigate = useNavigate();
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();

  const [transfers, setTransfers]   = useState<Transfer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<Tab>('balance');

  // ── Filtros globais ──────────────────────────────────────────────────────
  const today = useMemo(() => format(new Date(), 'dd/MM/yyyy'), []);
  const past30 = useMemo(() => format(subDays(new Date(), 30), 'dd/MM/yyyy'), []);
  const [dateFromBR, setDateFromBR] = useState(past30);
  const [dateToBR, setDateToBR]     = useState(today);
  const [filterHotelId, setFilterHotelId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'cancelled'>('completed');

  // Item selecionado na aba "Por Item"
  const [selectedItemId, setSelectedItemId] = useState<string>('');

  // Modal: cancelar dívida
  const [forgiveConfirm, setForgiveConfirm] = useState<{
    hotelId: string; hotelName: string;
    products: Array<{ productId: string; productName: string; net: number; cancelQty: string }>;
  } | null>(null);
  const [forgiving, setForgiving] = useState(false);

  // Expansões (aba Por Dia)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchTransfers = useCallback(async () => {
    if (!selectedHotel?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
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
      if (error) throw error;
      setTransfers((data || []) as unknown as Transfer[]);
    } catch (err: any) {
      console.error('Erro ao buscar transferências:', err);
      addNotification('Erro ao carregar transferências.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, addNotification]);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  // ── Aplicar filtros globais ─────────────────────────────────────────────
  const filteredTransfers = useMemo(() => {
    if (!selectedHotel?.id) return [] as Transfer[];

    const fromISO = brToISO(dateFromBR);
    const toISO   = brToISO(dateToBR);
    const term = searchTerm.trim().toLowerCase();

    return transfers.filter(t => {
      // Período
      const day = dateKey(t.created_at);
      if (fromISO && day < fromISO) return false;
      if (toISO   && day > toISO)   return false;

      // Status
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;

      // Hotel parceiro
      if (filterHotelId) {
        const otherId = t.source_hotel_id === selectedHotel.id
          ? t.destination_hotel_id : t.source_hotel_id;
        if (otherId !== filterHotelId) return false;
      }

      // Item (busca livre)
      if (term) {
        const name = t.product?.name?.toLowerCase() || '';
        if (!name.includes(term)) return false;
      }

      return true;
    });
  }, [transfers, selectedHotel, dateFromBR, dateToBR, statusFilter, filterHotelId, searchTerm]);

  // Lista de hotéis parceiros (pra dropdown)
  const partnerHotels = useMemo(() => {
    if (!selectedHotel?.id) return [];
    const map = new Map<string, string>();
    for (const t of transfers) {
      const otherId = t.source_hotel_id === selectedHotel.id ? t.destination_hotel_id : t.source_hotel_id;
      const otherName = t.source_hotel_id === selectedHotel.id
        ? (t.destination_hotel?.name || '?')
        : (t.source_hotel?.name || '?');
      if (otherId && !map.has(otherId)) map.set(otherId, otherName);
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [transfers, selectedHotel]);

  // Lista de itens únicos (pra aba Por Item — só os que aparecem nas transferências filtradas)
  const uniqueItems = useMemo(() => {
    const map = new Map<string, { id: string; name: string; category: string }>();
    for (const t of filteredTransfers) {
      if (t.product && !map.has(t.product.id)) {
        map.set(t.product.id, { id: t.product.id, name: t.product.name, category: t.product.category });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredTransfers]);

  // ── Aba 1: Saldo R$ ──────────────────────────────────────────────────────
  const balanceByHotel = useMemo(() => {
    if (!selectedHotel?.id) return [];
    type Row = {
      hotelId: string; hotelName: string;
      sentR: number; receivedR: number;
      sentUnits: number; receivedUnits: number;
      // detalhes por produto para o modal
      products: Map<string, { productId: string; productName: string; sentUnits: number; receivedUnits: number; sentR: number; receivedR: number }>;
    };
    const rowMap = new Map<string, Row>();
    for (const t of filteredTransfers) {
      const isSent  = t.source_hotel_id === selectedHotel.id;
      const otherId = isSent ? t.destination_hotel_id : t.source_hotel_id;
      const otherName = (isSent ? t.destination_hotel?.name : t.source_hotel?.name) || '?';
      if (!otherId) continue;
      if (!rowMap.has(otherId)) {
        rowMap.set(otherId, {
          hotelId: otherId, hotelName: otherName,
          sentR: 0, receivedR: 0, sentUnits: 0, receivedUnits: 0,
          products: new Map(),
        });
      }
      const r = rowMap.get(otherId)!;
      const value = (t.unit_value || 0) * t.quantity;
      const isReal = t.status === 'completed' || (t.status === 'cancelled' && t.notes?.includes('Dívida cancelada'));
      if (!isReal) continue;
      if (isSent) { r.sentR += value;     r.sentUnits += t.quantity; }
      else        { r.receivedR += value; r.receivedUnits += t.quantity; }

      const pid = t.product_id;
      if (!r.products.has(pid)) {
        r.products.set(pid, {
          productId: pid,
          productName: t.product?.name || 'Desconhecido',
          sentUnits: 0, receivedUnits: 0, sentR: 0, receivedR: 0,
        });
      }
      const p = r.products.get(pid)!;
      if (isSent) { p.sentUnits += t.quantity; p.sentR += value; }
      else        { p.receivedUnits += t.quantity; p.receivedR += value; }
    }
    return Array.from(rowMap.values()).sort((a, b) => a.hotelName.localeCompare(b.hotelName));
  }, [filteredTransfers, selectedHotel]);

  const totalBalance = useMemo(() => {
    let sentR = 0, receivedR = 0;
    for (const r of balanceByHotel) { sentR += r.sentR; receivedR += r.receivedR; }
    return { sentR, receivedR, net: sentR - receivedR };
  }, [balanceByHotel]);

  // ── Aba 2: Por Dia ───────────────────────────────────────────────────────
  const transfersByDay = useMemo(() => {
    const map = new Map<string, Transfer[]>();
    for (const t of filteredTransfers) {
      const k = dateKey(t.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // mais recente primeiro
      .map(([day, list]) => {
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        const totalR = list.reduce((s, t) => s + (t.unit_value || 0) * t.quantity, 0);
        return { day, list, totalR };
      });
  }, [filteredTransfers]);

  // ── Aba 3: Por Item ──────────────────────────────────────────────────────
  const itemHistory = useMemo(() => {
    if (!selectedItemId || !selectedHotel?.id) return null;
    const list = filteredTransfers.filter(t => t.product_id === selectedItemId);

    // Agrupa por hotel parceiro
    type ByHotel = {
      hotelId: string; hotelName: string;
      lines: Transfer[];
      totalUnits: number; totalR: number;
    };
    const map = new Map<string, ByHotel>();
    for (const t of list) {
      const isSent = t.source_hotel_id === selectedHotel.id;
      const otherId = isSent ? t.destination_hotel_id : t.source_hotel_id;
      const otherName = (isSent ? t.destination_hotel?.name : t.source_hotel?.name) || '?';
      if (!otherId) continue;
      if (!map.has(otherId)) {
        map.set(otherId, { hotelId: otherId, hotelName: otherName, lines: [], totalUnits: 0, totalR: 0 });
      }
      const r = map.get(otherId)!;
      r.lines.push(t);
      r.totalUnits += t.quantity;
      r.totalR += (t.unit_value || 0) * t.quantity;
    }
    for (const r of map.values()) r.lines.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const itemName = list[0]?.product?.name || uniqueItems.find(i => i.id === selectedItemId)?.name || '';
    return {
      itemName,
      byHotel: Array.from(map.values()).sort((a, b) => a.hotelName.localeCompare(b.hotelName)),
    };
  }, [selectedItemId, filteredTransfers, selectedHotel, uniqueItems]);

  // ── Export Excel ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    if (filteredTransfers.length === 0) {
      addNotification('Nenhuma transferência para exportar com os filtros atuais.', 'warning');
      return;
    }
    const rows = filteredTransfers.map(t => {
      const isSent = t.source_hotel_id === selectedHotel?.id;
      return {
        'Data':       format(parseISO(t.created_at), 'dd/MM/yyyy', { locale: ptBR }),
        'Hora':       format(parseISO(t.created_at), 'HH:mm'),
        'Direção':    isSent ? 'Enviado' : 'Recebido',
        'Origem':     t.source_hotel?.name || '',
        'Destino':    t.destination_hotel?.name || '',
        'Item':       t.product?.name || '',
        'Categoria':  t.product?.category || '',
        'Quantidade': t.quantity,
        'Valor Unit (R$)':  t.unit_value ?? '',
        'Valor Total (R$)': (t.unit_value || 0) * t.quantity,
        'Status':           t.status === 'completed' ? 'Concluída' : t.status === 'pending' ? 'Pendente' : 'Cancelada',
        'Observações':      t.notes || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transferências');
    const slug = (selectedHotel?.name || 'hotel').toLowerCase().replace(/\s+/g, '-');
    const fromISO = brToISO(dateFromBR) || 'inicio';
    const toISO   = brToISO(dateToBR)   || 'fim';
    XLSX.writeFile(wb, `transferencias_${slug}_${fromISO}_${toISO}.xlsx`);
    addNotification(`Exportadas ${rows.length} transferências.`, 'success');
  };

  // ── Cancelar dívida ──────────────────────────────────────────────────────
  const openForgiveModal = (hotelId: string, hotelName: string, products: Array<any>) => {
    const dueProducts = products.filter(p => {
      const net = p.sentUnits - p.receivedUnits;
      return net !== 0;
    }).map(p => ({
      productId: p.productId,
      productName: p.productName,
      net: p.sentUnits - p.receivedUnits,
      cancelQty: String(Math.abs(p.sentUnits - p.receivedUnits)),
    }));
    if (dueProducts.length === 0) {
      addNotification('Não há dívida pendente em unidades neste hotel.', 'warning');
      return;
    }
    setForgiveConfirm({ hotelId, hotelName, products: dueProducts });
  };

  const handleForgive = async () => {
    if (!forgiveConfirm || !selectedHotel?.id) return;
    const items = forgiveConfirm.products
      .map(p => ({ ...p, qty: parseInt(p.cancelQty) || 0 }))
      .filter(p => p.qty > 0);
    if (!items.length) {
      addNotification('Informe ao menos uma quantidade.', 'error');
      return;
    }
    const over = items.find(p => p.qty > Math.abs(p.net));
    if (over) {
      addNotification(`"${over.productName}": quantidade excede a dívida (${Math.abs(over.net)}).`, 'error');
      return;
    }
    setForgiving(true);
    try {
      for (const p of items) {
        const sourceId = p.net > 0 ? forgiveConfirm.hotelId : selectedHotel.id;
        const destId   = p.net > 0 ? selectedHotel.id : forgiveConfirm.hotelId;
        const { error } = await supabase.from('hotel_transfers').insert({
          source_hotel_id: sourceId, destination_hotel_id: destId,
          product_id: p.productId, quantity: p.qty,
          unit_value: null, status: 'cancelled',
          notes: 'Dívida cancelada', completed_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      addNotification(`Dívida de ${items.length} item(s) cancelada!`, 'success');
      setForgiveConfirm(null);
      fetchTransfers();
    } catch (err: any) {
      addNotification('Erro ao cancelar dívida: ' + (err.message || ''), 'error');
    } finally {
      setForgiving(false);
    }
  };

  // ── Toggle dia ───────────────────────────────────────────────────────────
  const toggleDay = (day: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

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
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
            <ArrowLeftRight className="h-8 w-8 text-orange-500" />
            Transferências
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {selectedHotel.name} — Saldos, histórico cronológico e auditoria
          </p>
        </div>
        <button
          onClick={exportExcel}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Exportar Excel
        </button>
      </div>

      {/* ── Filtros globais ──────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Período */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Período</label>
            <div className="flex items-center gap-2">
              <DateBRInput value={dateFromBR} onChange={setDateFromBR} />
              <span className="text-xs text-gray-400">até</span>
              <DateBRInput value={dateToBR} onChange={setDateToBR} />
            </div>
          </div>

          {/* Hotel parceiro */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Hotel parceiro</label>
            <select
              value={filterHotelId}
              onChange={e => setFilterHotelId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todos</option>
              {partnerHotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>

          {/* Busca por item */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Buscar item</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Nome do produto..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Status</label>
            <div className="flex gap-1.5">
              {(['all', 'completed', 'pending', 'cancelled'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-colors ${
                    statusFilter === s
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {s === 'all' ? 'Todas' : s === 'completed' ? 'Concl.' : s === 'pending' ? 'Pend.' : 'Canc.'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-t-xl shadow-sm border border-gray-100 dark:border-gray-700 border-b-0 px-2 pt-2 flex gap-1">
        {([
          { key: 'balance' as Tab, label: 'Saldo R$',    icon: HandCoins },
          { key: 'byDay' as Tab,   label: 'Por Dia',     icon: CalendarIcon },
          { key: 'byItem' as Tab,  label: 'Por Item',    icon: Package },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors ${
              tab === key
                ? 'bg-orange-500 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-b-xl rounded-tr-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <p className="text-sm">Carregando transferências...</p>
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Package className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium">Nenhuma transferência encontrada com os filtros atuais.</p>
          </div>
        ) : (
          <>
            {/* ─── Aba 1: Saldo R$ ──────────────────────────────────────── */}
            {tab === 'balance' && (
              <div className="space-y-3">
                {/* Total global */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <SummaryBox label="Total Enviado" value={fmtBRL(totalBalance.sentR)} color="text-red-600" icon={<ArrowUpRight className="w-4 h-4 text-red-500" />} />
                  <SummaryBox label="Total Recebido" value={fmtBRL(totalBalance.receivedR)} color="text-green-600" icon={<ArrowDownLeft className="w-4 h-4 text-green-500" />} />
                  <SummaryBox
                    label={totalBalance.net > 0 ? 'Devem-nos' : totalBalance.net < 0 ? 'Devemos' : 'Equilibrado'}
                    value={fmtBRL(Math.abs(totalBalance.net))}
                    color={totalBalance.net > 0 ? 'text-blue-600' : totalBalance.net < 0 ? 'text-orange-600' : 'text-gray-600'}
                    icon={<Scale className="w-4 h-4 text-blue-500" />}
                  />
                </div>

                {/* Tabela por hotel */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                        <th className="text-left py-2 px-3 font-semibold">Hotel</th>
                        <th className="text-right py-2 px-3 font-semibold">Enviado (R$)</th>
                        <th className="text-right py-2 px-3 font-semibold">Recebido (R$)</th>
                        <th className="text-right py-2 px-3 font-semibold">Saldo (R$)</th>
                        <th className="text-center py-2 px-3 font-semibold">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {balanceByHotel.map(r => {
                        const netR = r.sentR - r.receivedR;
                        const netUnits = r.sentUnits - r.receivedUnits;
                        return (
                          <tr key={r.hotelId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="py-3 px-3 font-semibold text-gray-800 dark:text-white">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-gray-400" />
                                {r.hotelName}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right text-red-600 dark:text-red-400">{fmtBRL(r.sentR)}</td>
                            <td className="py-3 px-3 text-right text-green-600 dark:text-green-400">{fmtBRL(r.receivedR)}</td>
                            <td className={`py-3 px-3 text-right font-bold ${netR > 0 ? 'text-blue-600' : netR < 0 ? 'text-orange-600' : 'text-gray-500'}`}>
                              {netR === 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Equilibrado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  {netR > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                  {netR > 0 ? '+' : ''}{fmtBRL(netR)}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {netUnits !== 0 && (
                                <button
                                  onClick={() => openForgiveModal(r.hotelId, r.hotelName, Array.from(r.products.values()))}
                                  className="px-3 py-1.5 text-xs font-semibold bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-lg transition-colors"
                                >
                                  Cancelar dívida
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── Aba 2: Por Dia ──────────────────────────────────────────── */}
            {tab === 'byDay' && (
              <div className="space-y-2">
                {transfersByDay.map(({ day, list, totalR }) => {
                  const isOpen = expandedDays.has(day);
                  const dayDate = parseISO(day);
                  return (
                    <div key={day} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                      <button
                        onClick={() => toggleDay(day)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                          <div className="text-left">
                            <p className="font-semibold text-gray-800 dark:text-white">
                              {format(dayDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                              {format(dayDate, 'EEEE', { locale: ptBR })} · {list.length} transferência{list.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtBRL(totalR)}</p>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider">total movimentado</p>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50/50 dark:bg-gray-800/50 text-[10px] uppercase text-gray-500">
                              <tr>
                                <th className="text-left  py-2 px-3 font-semibold">Hora</th>
                                <th className="text-left  py-2 px-3 font-semibold">Dir</th>
                                <th className="text-left  py-2 px-3 font-semibold">Hotel</th>
                                <th className="text-left  py-2 px-3 font-semibold">Item</th>
                                <th className="text-right py-2 px-3 font-semibold">Qtd</th>
                                <th className="text-right py-2 px-3 font-semibold">V. Unit</th>
                                <th className="text-right py-2 px-3 font-semibold">V. Total</th>
                                <th className="text-center py-2 px-3 font-semibold">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {list.map(t => {
                                const isSent = t.source_hotel_id === selectedHotel.id;
                                const otherName = (isSent ? t.destination_hotel?.name : t.source_hotel?.name) || '?';
                                const total = (t.unit_value || 0) * t.quantity;
                                return (
                                  <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                    <td className="py-2 px-3 text-gray-700 dark:text-gray-300 font-mono">{format(parseISO(t.created_at), 'HH:mm')}</td>
                                    <td className="py-2 px-3">
                                      {isSent
                                        ? <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-bold">→</span>
                                        : <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-bold">←</span>}
                                    </td>
                                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200">{otherName}</td>
                                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200">
                                      {t.product?.name || '—'}
                                      {t.product?.category && (
                                        <span className="ml-1 text-[10px] text-gray-400">· {t.product.category}</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right font-semibold text-gray-800 dark:text-gray-200">{t.quantity}</td>
                                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{fmtBRLOrDash(t.unit_value)}</td>
                                    <td className="py-2 px-3 text-right font-bold text-gray-800 dark:text-gray-200">
                                      {t.unit_value != null ? fmtBRL(total) : '—'}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      <StatusBadge status={t.status} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ─── Aba 3: Por Item ─────────────────────────────────────────── */}
            {tab === 'byItem' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    Selecione um item
                  </label>
                  <ItemCombobox
                    items={uniqueItems}
                    value={selectedItemId}
                    onChange={setSelectedItemId}
                  />
                </div>

                {!selectedItemId && (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                    <Package className="w-10 h-10 opacity-30" />
                    <p className="text-sm">Selecione um item acima para ver o histórico por período.</p>
                  </div>
                )}

                {itemHistory && itemHistory.byHotel.map(h => (
                  <div key={h.hotelId} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/40">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <p className="font-semibold text-gray-800 dark:text-white">{h.hotelName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtBRL(h.totalR)}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{h.totalUnits} unidades</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50/50 dark:bg-gray-800/50 text-[10px] uppercase text-gray-500">
                          <tr>
                            <th className="text-left  py-2 px-3 font-semibold">Data</th>
                            <th className="text-left  py-2 px-3 font-semibold">Dir</th>
                            <th className="text-right py-2 px-3 font-semibold">Qtd</th>
                            <th className="text-right py-2 px-3 font-semibold">V. Unit (nesse dia)</th>
                            <th className="text-right py-2 px-3 font-semibold">V. Total</th>
                            <th className="text-center py-2 px-3 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {h.lines.map(t => {
                            const isSent = t.source_hotel_id === selectedHotel.id;
                            const total = (t.unit_value || 0) * t.quantity;
                            return (
                              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                <td className="py-2 px-3 text-gray-700 dark:text-gray-300">
                                  {format(parseISO(t.created_at), 'dd/MM/yyyy HH:mm')}
                                </td>
                                <td className="py-2 px-3">
                                  {isSent
                                    ? <span className="text-red-600 dark:text-red-400 font-bold">→</span>
                                    : <span className="text-green-600 dark:text-green-400 font-bold">←</span>}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold text-gray-800 dark:text-gray-200">{t.quantity}</td>
                                <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{fmtBRLOrDash(t.unit_value)}</td>
                                <td className="py-2 px-3 text-right font-bold text-gray-800 dark:text-gray-200">
                                  {t.unit_value != null ? fmtBRL(total) : '—'}
                                </td>
                                <td className="py-2 px-3 text-center"><StatusBadge status={t.status} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal: Cancelar Dívida ───────────────────────────────────────── */}
      {forgiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">Cancelar dívida</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">com {forgiveConfirm.hotelName}</p>
              </div>
              <button onClick={() => setForgiveConfirm(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>Cancelar uma dívida registra uma "compensação virtual" que zera o saldo em unidades. Use quando as partes acertaram fora do sistema.</p>
              </div>
              <div className="space-y-2">
                {forgiveConfirm.products.map(p => (
                  <div key={p.productId} className="flex items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{p.productName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Saldo: {p.net > 0 ? 'devem' : 'devendo'} {Math.abs(p.net)} un
                      </p>
                    </div>
                    <input
                      type="number" min={0} max={Math.abs(p.net)}
                      value={p.cancelQty}
                      onChange={e => setForgiveConfirm({
                        ...forgiveConfirm,
                        products: forgiveConfirm.products.map(x => x.productId === p.productId ? { ...x, cancelQty: e.target.value } : x),
                      })}
                      className="w-20 px-2 py-1.5 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setForgiveConfirm(null)} className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                Cancelar
              </button>
              <button
                onClick={handleForgive}
                disabled={forgiving}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-60 flex items-center gap-2"
              >
                {forgiving && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────────

// Combobox com busca type-ahead — substitui o <select> nativo (ruim com 500+ itens)
function ItemCombobox({ items, value, onChange }: {
  items: Array<{ id: string; name: string; category: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const boxRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = items.find(i => i.id === value) || null;

  // Filtra por nome/categoria (case-insensitive, ignora acentos básicos)
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return items.slice(0, 100);
    return items.filter(i => norm(i.name).includes(q) || norm(i.category || '').includes(q)).slice(0, 100);
  }, [items, query]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => { setHighlight(0); }, [query]);

  const pick = (id: string) => { onChange(id); setOpen(false); setQuery(''); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight].id); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : (selected ? `${selected.name}${selected.category ? ` (${selected.category})` : ''}` : '')}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onKeyDown={onKey}
          placeholder="Digite para buscar um produto..."
          className="w-full pl-10 pr-16 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500"
        />
        {selected && !open && (
          <button
            onClick={() => { onChange(''); setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            aria-label="Limpar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => { setOpen(o => !o); if (!open) { setQuery(''); inputRef.current?.focus(); } }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 p-1"
          aria-label="Abrir lista"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum produto encontrado.</div>
          ) : (
            filtered.map((it, idx) => (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                onMouseEnter={() => setHighlight(idx)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2
                  ${idx === highlight ? 'bg-orange-50 dark:bg-orange-900/20' : ''}
                  ${it.id === value ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-gray-800 dark:text-gray-200'}`}
              >
                <span className="truncate">{it.name}</span>
                {it.category && <span className="text-[11px] text-gray-400 flex-shrink-0">{it.category}</span>}
              </button>
            ))
          )}
          {items.length > 100 && query.trim() === '' && (
            <div className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-700">
              Mostrando primeiros 100 — digite para refinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBox({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      <CheckCircle2 className="w-3 h-3" /> Concl.
    </span>
  );
  if (status === 'pending') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
      <Clock className="w-3 h-3" /> Pend.
    </span>
  );
  if (status === 'cancelled') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <X className="w-3 h-3" /> Canc.
    </span>
  );
  return null;
}

export default TransferHistory;
