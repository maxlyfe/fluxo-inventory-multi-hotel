import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Search, Loader2, CheckCircle2, AlertTriangle, FileCheck,
  ChevronDown, ChevronUp, Calendar, User, Building2, Filter,
  CheckSquare, Square, Zap, RefreshCw, Download, Eye, X,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { erbonService, type ErbonBooking } from '../../lib/erbonService';
import { nfService, type BatchEmissionProgress } from '../../lib/nfService';
import { PeriodFilter, defaultPeriod, type Period } from '../../components/financial/shared';
import NFInvoiceModal, { type CurrentAccountEntry } from '../../components/nf/NFInvoiceModal';
import NFViewerModal from '../../components/nf/NFViewerModal';
import type { NFInvoice, NFTipo } from '../../types/nf';

// ── Unified reservation type ─────────────────────────────────────────────────

interface UnifiedReservation {
  id: string;
  source: 'erbon' | 'internal';
  bookingInternalId: number | null;
  bookingNumber: string;
  guestName: string;
  guestDoc: string | null;
  guestDocType: 'cpf' | 'cnpj' | 'passaporte' | null;
  guestEmail: string | null;
  guestNationality: string | null;
  roomDescription: string;
  checkIn: string;
  checkOut: string;
  totalValue: number;
  status: string;
  raw: any;
}

type TabKey = 'adequadas' | 'revisao' | 'emitida';

interface ClassifiedReservation extends UnifiedReservation {
  tab: TabKey;
  issues: string[];
  invoiceId?: string;
  invoice?: NFInvoice;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractGuestDoc(booking: ErbonBooking): { doc: string | null; type: 'cpf' | 'cnpj' | 'passaporte' | null } {
  const guest = booking.guestList?.[0];
  if (!guest?.documents?.length) return { doc: null, type: null };
  for (const d of guest.documents) {
    const dt = (d.documentType || '').toLowerCase();
    if (dt.includes('cpf')) return { doc: d.number, type: 'cpf' };
    if (dt.includes('cnpj')) return { doc: d.number, type: 'cnpj' };
    if (dt.includes('passaporte') || dt.includes('passport')) return { doc: d.number, type: 'passaporte' };
  }
  return { doc: guest.documents[0]?.number || null, type: null };
}

function erbonToUnified(b: ErbonBooking): UnifiedReservation {
  const { doc, type } = extractGuestDoc(b);
  const guest = b.guestList?.[0];
  return {
    id: `erbon-${b.bookingInternalID}`,
    source: 'erbon',
    bookingInternalId: b.bookingInternalID,
    bookingNumber: String(b.erbonNumber),
    guestName: guest?.name || 'Hóspede',
    guestDoc: doc,
    guestDocType: type,
    guestEmail: guest?.email || null,
    guestNationality: null,
    roomDescription: b.roomDescription || b.roomTypeDescription || '',
    checkIn: b.checkInDateTime,
    checkOut: b.checkOutDateTime,
    totalValue: b.totalBookingRateWithTax || b.totalBookingRate || 0,
    status: b.status,
    raw: b,
  };
}

function internalToUnified(b: any): UnifiedReservation {
  return {
    id: `internal-${b.id}`,
    source: 'internal',
    bookingInternalId: null,
    bookingNumber: b.booking_number || b.id?.slice(0, 8),
    guestName: b.guest_name || 'Hóspede',
    guestDoc: b.guest_doc || null,
    guestDocType: b.guest_doc_type || null,
    guestEmail: b.guest_email || null,
    guestNationality: b.guest_nationality || null,
    roomDescription: b.room_description || '',
    checkIn: b.check_in,
    checkOut: b.check_out,
    totalValue: b.total_value || 0,
    status: b.status,
    raw: b,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EmissaoNFPage() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const hotelId = selectedHotel?.id || '';

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [filterBy, setFilterBy] = useState<'checkout' | 'checkin'>('checkout');
  const [loading, setLoading] = useState(false);
  const [reservations, setReservations] = useState<ClassifiedReservation[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('adequadas');

  // Selection for batch
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<{ booking: UnifiedReservation; entries: CurrentAccountEntry[] } | null>(null);
  const [viewerInvoiceId, setViewerInvoiceId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchEmissionProgress | null>(null);
  const [batchTipoNf, setBatchTipoNf] = useState<NFTipo | null>(null);

  // ── Load reservations ─────────────────────────────────────────────────────

  const loadReservations = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    setSelected(new Set());

    try {
      // Fetch in parallel: Erbon bookings, internal bookings, existing invoices
      const [erbonBookings, internalRes, invoicesRes] = await Promise.all([
        erbonService.searchBookings(hotelId, {
          [filterBy === 'checkout' ? 'checkout' : 'checkin']: period.from,
          ...(filterBy === 'checkout' ? { checkout: period.from } : { checkin: period.from }),
          status: 'CHECKOUT',
        }).catch(() => [] as ErbonBooking[]),
        supabase.from('internal_bookings')
          .select('*')
          .eq('hotel_id', hotelId)
          .eq('status', 'checkedout')
          .gte(filterBy === 'checkout' ? 'check_out' : 'check_in', period.from)
          .lte(filterBy === 'checkout' ? 'check_out' : 'check_in', period.to),
        supabase.from('nf_invoices')
          .select('*')
          .eq('hotel_id', hotelId)
          .in('status', ['autorizada', 'contingencia']),
      ]);

      const unified: UnifiedReservation[] = [
        ...erbonBookings.map(erbonToUnified),
        ...(internalRes.data || []).map(internalToUnified),
      ];

      // Build invoice lookup: booking_number -> invoice
      const invoiceMap = new Map<string, NFInvoice>();
      const invoiceByErbonId = new Map<number, NFInvoice>();
      (invoicesRes.data || []).forEach((inv: NFInvoice) => {
        if (inv.booking_number) invoiceMap.set(inv.booking_number, inv);
        if (inv.erbon_booking_id) invoiceByErbonId.set(inv.erbon_booking_id, inv);
      });

      // Classify
      const classified: ClassifiedReservation[] = unified.map(r => {
        const inv = invoiceMap.get(r.bookingNumber) ||
          (r.bookingInternalId ? invoiceByErbonId.get(r.bookingInternalId) : undefined);

        if (inv && (inv.status === 'autorizada' || inv.status === 'contingencia')) {
          return { ...r, tab: 'emitida' as TabKey, issues: [], invoiceId: inv.id, invoice: inv };
        }

        const issues: string[] = [];
        if (!r.guestName || r.guestName === 'Hóspede') issues.push('Nome do hóspede ausente');
        if (!r.guestDoc && !r.guestDocType) {
          // sem doc é ok (consumidor final), mas marca como revisão se nome tb falta
        }
        if (r.totalValue <= 0) issues.push('Valor total zero');

        if (issues.length > 0) {
          return { ...r, tab: 'revisao' as TabKey, issues };
        }

        return { ...r, tab: 'adequadas' as TabKey, issues: [] };
      });

      setReservations(classified);
    } catch (err: any) {
      addNotification('error', `Erro ao carregar reservas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [hotelId, period, filterBy, addNotification]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  // ── Tab counts ─────────────────────────────────────────────────────────────

  const tabCounts = useMemo(() => {
    const counts = { adequadas: 0, revisao: 0, emitida: 0 };
    reservations.forEach(r => counts[r.tab]++);
    return counts;
  }, [reservations]);

  const filtered = useMemo(() => reservations.filter(r => r.tab === activeTab), [reservations, activeTab]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.id)));
    }
  };

  // ── Batch emission ─────────────────────────────────────────────────────────

  const handleBatchStart = (tipo: NFTipo) => {
    setBatchTipoNf(tipo);
  };

  const handleBatchConfirm = async () => {
    if (!batchTipoNf || selected.size === 0) return;
    setBatchRunning(true);
    setBatchProgress(null);

    try {
      // Create draft invoices for each selected reservation
      const invoiceIds: string[] = [];
      const selectedReservations = filtered.filter(r => selected.has(r.id));

      for (const r of selectedReservations) {
        const { data: inv, error } = await supabase.from('nf_invoices').insert({
          hotel_id: hotelId,
          tipo: batchTipoNf,
          erbon_booking_id: r.bookingInternalId,
          booking_number: r.bookingNumber,
          room_description: r.roomDescription,
          tomador_nome: r.guestName,
          tomador_cpf_cnpj: r.guestDoc,
          tomador_doc_tipo: r.guestDocType || 'cpf',
          tomador_email: r.guestEmail,
          valor_total: r.totalValue,
          valor_deducoes: 0,
          valor_iss: 0,
          base_calculo: r.totalValue,
          aliquota: 0,
          status: 'rascunho',
        }).select('id').single();

        if (error) throw error;
        invoiceIds.push(inv.id);
      }

      const result = await nfService.batchEmitInvoices(invoiceIds, hotelId, setBatchProgress);
      addNotification(
        result.failures.length === 0 ? 'success' : 'warning',
        `Lote concluído: ${result.successes.length} sucesso(s), ${result.failures.length} falha(s)`,
      );
      loadReservations();
    } catch (err: any) {
      addNotification('error', `Erro no lote: ${err.message}`);
    } finally {
      setBatchRunning(false);
      setBatchTipoNf(null);
      setSelected(new Set());
    }
  };

  // ── Open single emission ───────────────────────────────────────────────────

  const handleOpenEmission = async (r: ClassifiedReservation) => {
    let entries: CurrentAccountEntry[] = [];
    if (r.source === 'erbon' && r.bookingInternalId) {
      try {
        const account = await erbonService.fetchBookingAccount(hotelId, r.bookingInternalId);
        entries = (account || []).map((e: any) => ({
          id: e.id || e.internalID,
          description: e.description || e.descricao || 'Item',
          amount: Math.abs(e.value || e.valor || 0),
          isDebit: (e.value || e.valor || 0) > 0,
          isCredit: (e.value || e.valor || 0) < 0,
          currency: 'BRL',
          isInvoiced: false,
          idDepartment: e.departmentID || 0,
        }));
      } catch { /* conta corrente pode não estar disponível */ }
    }
    setInvoiceModal({ booking: r, entries });
  };

  // ── Mark as adequate ───────────────────────────────────────────────────────

  const handleMarkAdequate = (id: string) => {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, tab: 'adequadas' as TabKey, issues: [] } : r));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!hotelId) {
    return <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Selecione um hotel.</div>;
  }

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; color: string; count: number }[] = [
    { key: 'adequadas', label: 'Adequadas', icon: <CheckCircle2 className="w-4 h-4" />, color: 'green', count: tabCounts.adequadas },
    { key: 'revisao', label: 'Revisão', icon: <AlertTriangle className="w-4 h-4" />, color: 'amber', count: tabCounts.revisao },
    { key: 'emitida', label: 'NF Emitida', icon: <FileCheck className="w-4 h-4" />, color: 'blue', count: tabCounts.emitida },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Emissão de NF</h1>
        </div>
        <div className="flex-1" />
        <button onClick={loadReservations} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <PeriodFilter period={period} onChange={setPeriod} />
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterBy}
            onChange={e => setFilterBy(e.target.value as 'checkout' | 'checkin')}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800"
          >
            <option value="checkout">Check-out</option>
            <option value="checkin">Check-in</option>
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {tabs.map(t => {
          const active = activeTab === t.key;
          const colorMap: Record<string, string> = {
            green: active ? 'bg-green-500 text-white' : 'text-green-700 dark:text-green-400',
            amber: active ? 'bg-amber-500 text-white' : 'text-amber-700 dark:text-amber-400',
            blue: active ? 'bg-blue-500 text-white' : 'text-blue-700 dark:text-blue-400',
          };
          return (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setSelected(new Set()); }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${active ? colorMap[t.color] + ' shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
            >
              {t.icon}
              <span>{t.label}</span>
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${active ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Batch actions for Adequadas tab */}
      {activeTab === 'adequadas' && filtered.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            {selected.size === filtered.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selected.size === filtered.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
          {selected.size >= 2 && !batchTipoNf && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-500">{selected.size} selecionada(s)</span>
              <button onClick={() => handleBatchStart('nfse')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                <Zap className="w-4 h-4" /> Emitir NFS-e em Lote
              </button>
              <button onClick={() => handleBatchStart('nfe')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                <Zap className="w-4 h-4" /> Emitir NF-e em Lote
              </button>
            </div>
          )}
        </div>
      )}

      {/* Batch confirmation dialog */}
      {batchTipoNf && !batchRunning && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            Emitir {selected.size} {batchTipoNf === 'nfse' ? 'NFS-e' : 'NF-e'}(s) em lote?
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">As notas serão emitidas sequencialmente com intervalo de 1s entre cada.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={handleBatchConfirm} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">Confirmar</button>
            <button onClick={() => setBatchTipoNf(null)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-sm font-medium">Cancelar</button>
          </div>
        </div>
      )}

      {/* Batch progress */}
      {batchRunning && batchProgress && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <span className="font-semibold text-blue-800 dark:text-blue-200">{batchProgress.currentLabel}</span>
          </div>
          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2.5 mb-2">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">{batchProgress.successes} sucesso(s)</span>
            <span className="text-red-600">{batchProgress.failures} falha(s)</span>
            <span className="text-gray-500">{batchProgress.current}/{batchProgress.total}</span>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="ml-3 text-gray-500">Carregando reservas...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg">Nenhuma reserva {activeTab === 'emitida' ? 'com NF emitida' : activeTab === 'revisao' ? 'para revisão' : 'pronta para emissão'} no período.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <ReservationCard
              key={r.id}
              reservation={r}
              activeTab={activeTab}
              expanded={expandedId === r.id}
              isSelected={selected.has(r.id)}
              onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onToggleSelect={() => toggleSelect(r.id)}
              onEmit={() => handleOpenEmission(r)}
              onViewNF={() => r.invoiceId && setViewerInvoiceId(r.invoiceId)}
              onMarkAdequate={() => handleMarkAdequate(r.id)}
            />
          ))}
        </div>
      )}

      {/* Invoice Emission Modal */}
      {invoiceModal && (
        <NFInvoiceModal
          isOpen
          onClose={() => setInvoiceModal(null)}
          tipo="nfse"
          hotelId={hotelId}
          booking={{
            bookingInternalID: invoiceModal.booking.bookingInternalId,
            erbonNumber: invoiceModal.booking.bookingNumber,
            roomDescription: invoiceModal.booking.roomDescription,
            guestList: [{
              name: invoiceModal.booking.guestName,
              email: invoiceModal.booking.guestEmail || '',
              phone: '',
              documents: invoiceModal.booking.guestDoc ? [{ documentType: invoiceModal.booking.guestDocType || 'cpf', number: invoiceModal.booking.guestDoc }] : [],
            }],
          }}
          selectedEntries={invoiceModal.entries}
          onSuccess={() => {
            setInvoiceModal(null);
            loadReservations();
          }}
        />
      )}

      {/* NF Viewer Modal */}
      {viewerInvoiceId && (
        <NFViewerModal
          isOpen
          onClose={() => setViewerInvoiceId(null)}
          invoiceId={viewerInvoiceId}
          hotelId={hotelId}
        />
      )}
    </div>
  );
}

// ── Reservation Card ─────────────────────────────────────────────────────────

interface ReservationCardProps {
  reservation: ClassifiedReservation;
  activeTab: TabKey;
  expanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onEmit: () => void;
  onViewNF: () => void;
  onMarkAdequate: () => void;
}

function ReservationCard({ reservation: r, activeTab, expanded, isSelected, onToggleExpand, onToggleSelect, onEmit, onViewNF, onMarkAdequate }: ReservationCardProps) {
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
  };

  return (
    <div className={`border rounded-xl transition-all ${
      activeTab === 'emitida' ? 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10'
      : activeTab === 'revisao' ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10'
      : isSelected ? 'border-green-400 dark:border-green-600 bg-green-50/50 dark:bg-green-900/20 ring-1 ring-green-300'
      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggleExpand}>
        {/* Select checkbox (Adequadas only) */}
        {activeTab === 'adequadas' && (
          <button onClick={e => { e.stopPropagation(); onToggleSelect(); }} className="flex-shrink-0">
            {isSelected
              ? <CheckSquare className="w-5 h-5 text-green-600" />
              : <Square className="w-5 h-5 text-gray-400" />
            }
          </button>
        )}

        {/* Guest + booking info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-semibold text-gray-900 dark:text-white truncate">{r.guestName}</span>
            <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              #{r.bookingNumber}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${r.source === 'erbon' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'}`}>
              {r.source === 'erbon' ? 'Erbon' : 'Interna'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {r.roomDescription}</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(r.checkIn)} → {fmtDate(r.checkOut)}</span>
            {r.guestDoc && <span>{r.guestDocType === 'cnpj' ? 'CNPJ' : r.guestDocType === 'passaporte' ? 'Pass.' : 'CPF'}: {r.guestDoc}</span>}
          </div>
        </div>

        {/* Value + Issues */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {activeTab === 'revisao' && r.issues.length > 0 && (
            <div className="flex flex-col items-end gap-0.5">
              {r.issues.map((issue, i) => (
                <span key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {issue}
                </span>
              ))}
            </div>
          )}
          {activeTab === 'emitida' && r.invoice && (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              {r.invoice.tipo === 'nfse' ? 'NFS-e' : 'NF-e'} {r.invoice.numero_nf ? `nº ${r.invoice.numero_nf}` : ''}
            </span>
          )}
          <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
            R$ {r.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
            <div><span className="text-gray-500 text-xs">Nome</span><br /><span className="font-medium">{r.guestName}</span></div>
            <div><span className="text-gray-500 text-xs">Documento</span><br /><span className="font-medium">{r.guestDoc || 'Não informado'}</span></div>
            <div><span className="text-gray-500 text-xs">E-mail</span><br /><span className="font-medium">{r.guestEmail || '—'}</span></div>
            <div><span className="text-gray-500 text-xs">Valor Total</span><br /><span className="font-medium">R$ {r.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {activeTab === 'adequadas' && (
              <button onClick={onEmit} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                <FileText className="w-4 h-4" /> Emitir NF
              </button>
            )}
            {activeTab === 'revisao' && (
              <button onClick={onMarkAdequate} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors">
                <CheckCircle2 className="w-4 h-4" /> Marcar como Adequada
              </button>
            )}
            {activeTab === 'emitida' && (
              <>
                <button onClick={onViewNF} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                  <Eye className="w-4 h-4" /> Ver NF
                </button>
                {r.invoice?.xml_retorno && (
                  <button
                    onClick={() => {
                      const blob = new Blob([r.invoice!.xml_retorno!], { type: 'application/xml' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `NF_${r.invoice!.numero_nf || r.invoiceId}.xml`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" /> XML
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
