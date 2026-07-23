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
import { NFInvoiceModal, isServiceEntry, type CurrentAccountEntry, type GenericNFItem } from '../../components/nf/NFInvoiceModal';
import { matchesEligibleService, isHomologForTipo } from '../../lib/nfService';
import NFViewerModal from '../../components/nf/NFViewerModal';
import type { NFInvoice, NFTipo } from '../../types/nf';
import { usePermissions } from '../../hooks/usePermissions';

// Formas de pagamento (tPag SEFAZ) — obrigatória para NFC-e, igual ao planning
const TPAG_OPTIONS: Array<[string, string]> = [
  ['01', 'Dinheiro'],
  ['03', 'Cartão de Crédito'],
  ['04', 'Cartão de Débito'],
  ['17', 'PIX'],
  ['15', 'Boleto Bancário'],
  ['18', 'Transferência / Carteira Digital'],
  ['05', 'Crédito Loja'],
  ['99', 'Outros'],
];


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
  /** Notas válidas emitidas em produção para esta reserva (qualquer tela de origem) */
  invoices: NFInvoice[];
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
    bookingNumber: b.code || b.id?.slice(0, 8),
    guestName: b.guest_name || 'Hóspede',
    guestDoc: b.guest_doc || null,
    guestDocType: b.guest_doc_type || null,
    guestEmail: b.guest_email || null,
    guestNationality: b.guest_nationality || null,
    roomDescription: b.room_description || '',
    checkIn: b.checkin,
    checkOut: b.checkout,
    totalValue: b.total_rate || 0,
    status: b.status,
    raw: b,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EmissaoNFPage() {
  const { selectedHotel } = useHotel();
  const { addNotification } = useNotification();
  const hotelId = selectedHotel?.id || '';
  const { can } = usePermissions();

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [filterBy, setFilterBy] = useState<'checkout' | 'checkin'>('checkout');
  const [loading, setLoading] = useState(false);
  const [reservations, setReservations] = useState<ClassifiedReservation[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('adequadas');

  // Selection for batch
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<{
    booking: UnifiedReservation;
    tipo: NFTipo;
    entries: CurrentAccountEntry[];
    genericItems?: GenericNFItem[];
    internalChargeIds?: string[];
  } | null>(null);
  const [viewerInvoiceId, setViewerInvoiceId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchEmissionProgress | null>(null);
  const [batchTipoNf, setBatchTipoNf] = useState<NFTipo | null>(null);
  // Forma de pagamento do lote (obrigatória para NFC-e, mesma regra do planning)
  const [batchTPag, setBatchTPag] = useState('');

  // ── Load reservations ─────────────────────────────────────────────────────

  const loadReservations = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    setSelected(new Set());

    try {
      // Build array of dates in the period (Erbon API accepts one date per call)
      const dates: string[] = [];
      const dateKey = filterBy === 'checkout' ? 'checkout' : 'checkin';
      for (let d = new Date(period.from + 'T12:00:00'); d <= new Date(period.to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }

      // Fetch Erbon bookings for all dates in parallel, plus internal bookings, invoices, config
      const erbonSettled = await Promise.allSettled(
        dates.map(date => erbonService.searchBookings(hotelId, { [dateKey]: date, status: 'CHECKOUT' }))
      );
      const seen = new Set<number>();
      const erbonBookings: ErbonBooking[] = [];
      for (const r of erbonSettled) {
        if (r.status !== 'fulfilled') continue;
        for (const b of r.value) {
          if (b.bookingInternalID && seen.has(b.bookingInternalID)) continue;
          if (b.bookingInternalID) seen.add(b.bookingInternalID);
          erbonBookings.push(b);
        }
      }

      const [internalRes, invoicesRes, nfConfig] = await Promise.all([
        supabase.from('internal_bookings')
          .select('*')
          .eq('hotel_id', hotelId)
          .eq('status', 'checkedout')
          .gte(filterBy === 'checkout' ? 'checkout' : 'checkin', period.from)
          .lte(filterBy === 'checkout' ? 'checkout' : 'checkin', period.to),
        supabase.from('nf_invoices')
          .select('*')
          .eq('hotel_id', hotelId)
          .in('status', ['autorizada', 'contingencia']),
        nfService.getConfig(hotelId),
      ]);

      const unified: UnifiedReservation[] = [
        ...erbonBookings.map(erbonToUnified),
        ...(internalRes.data || []).map(internalToUnified),
      ];

      // Lookup de notas por reserva (TODAS, não só a última): uma reserva pode
      // ter NFS-e e NFC-e emitidas em telas diferentes (planning, esta página)
      const invoiceMap = new Map<string, NFInvoice[]>();
      const invoiceByErbonId = new Map<number, NFInvoice[]>();
      (invoicesRes.data || []).forEach((inv: NFInvoice) => {
        if (inv.booking_number) {
          invoiceMap.set(inv.booking_number, [...(invoiceMap.get(inv.booking_number) || []), inv]);
        }
        if (inv.erbon_booking_id) {
          invoiceByErbonId.set(inv.erbon_booking_id, [...(invoiceByErbonId.get(inv.erbon_booking_id) || []), inv]);
        }
      });

      // Classify
      const classified: ClassifiedReservation[] = unified.map(r => {
        const found = [
          ...(invoiceMap.get(r.bookingNumber) || []),
          ...(r.bookingInternalId ? (invoiceByErbonId.get(r.bookingInternalId) || []) : []),
        ];
        // dedupe por id e mantém só notas do TIPO emitido em produção — homolog
        // de um tipo não libera reemissão do outro
        const seen = new Set<string>();
        const blocking = found.filter(inv => {
          if (seen.has(inv.id)) return false;
          seen.add(inv.id);
          return !isHomologForTipo(nfConfig, inv.tipo);
        });

        if (blocking.length > 0) {
          return { ...r, tab: 'emitida' as TabKey, issues: [], invoices: blocking };
        }

        const issues: string[] = [];
        if (!r.guestName || r.guestName === 'Hóspede') issues.push('Nome do hóspede ausente');
        // NFS-e exige documento do tomador (mesma regra do planning);
        // a NFC-e aceita consumidor sem identificação.
        if (!r.guestDoc) issues.push('Documento ausente (necessário para NFS-e)');
        if (r.totalValue <= 0) issues.push('Valor total zero');

        if (issues.length > 0) {
          return { ...r, tab: 'revisao' as TabKey, issues, invoices: [] };
        }

        return { ...r, tab: 'adequadas' as TabKey, issues: [], invoices: [] };
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
    setBatchTPag('');
    setBatchTipoNf(tipo);
  };

  // Busca os lançamentos de débito da conta corrente Erbon (excluindo já emitidos)
  const fetchErbonDebits = async (bookingInternalId: number, emitted: Map<number, string>): Promise<CurrentAccountEntry[]> => {
    const account = await erbonService.fetchBookingAccount(hotelId, bookingInternalId);
    return (account || [])
      .filter((e: any) => e.isDebit && !emitted.has(e.id))
      .map((e: any) => ({
        id: e.id,
        description: e.description || 'Item',
        amount: e.amount ?? 0,
        isDebit: true,
        isCredit: false,
        currency: e.currency || 'BRL',
        isInvoiced: !!e.isInvoiced,
        idDepartment: e.idDepartment ?? 0,
      }));
  };

  // Lançamentos internos ainda não faturados (mesma fonte do planning)
  const fetchInternalCharges = async (internalBookingId: string) => {
    const { data } = await supabase
      .from('internal_booking_charges')
      .select('id, service_id, description, quantity, total, invoice_id')
      .eq('booking_id', internalBookingId);
    return (data || []).filter((c: any) => !c.invoice_id);
  };

  const handleBatchConfirm = async () => {
    if (!batchTipoNf || selected.size === 0) return;
    if (batchTipoNf === 'nfce' && !batchTPag) {
      addNotification('error', 'Selecione a forma de pagamento antes de emitir NFC-e em lote.');
      return;
    }
    setBatchRunning(true);
    setBatchProgress(null);

    const failures: Array<{ label: string; error: string }> = [];
    const invoiceIds: string[] = [];
    const pagamentosById: Record<string, { tPag: string; vPag: number }[]> = {};
    const chargesByInvoice: Record<string, string[]> = {};

    try {
      const selectedReservations = filtered.filter(r => selected.has(r.id));
      const [nfceEligible, emitted] = await Promise.all([
        nfService.getNfceEligibleServices(hotelId).catch(() => []),
        nfService.getEmittedEntries(hotelId).catch(() => new Map<number, string>()),
      ]);
      const isAcrescimo = (e: { description: string }) =>
        nfceEligible.some(s => matchesEligibleService(e.description, s));

      // 1. Monta o rascunho de cada reserva com os itens reais da conta,
      //    aplicando as mesmas regras do modal (serviços × produtos separados)
      for (const r of selectedReservations) {
        const label = `${r.guestName} (#${r.bookingNumber})`;
        try {
          // NFC-e aceita consumidor sem identificação; NFS-e exige documento
          if (batchTipoNf === 'nfse' && !r.guestDoc) {
            failures.push({ label, error: 'Sem documento do tomador (obrigatório para NFS-e). Emita individualmente informando o documento.' });
            continue;
          }

          let internalChargeIds: string[] = [];
          let items: Array<{
            erbon_entry_id: number | null; descricao: string; quantidade: number;
            valor_unitario: number; valor_total: number;
            ncm?: string | null; cfop?: string | null; icms_aliquota?: number | null; icms_valor?: number | null;
            codigo_servico?: string | null; iss_aliquota?: number | null; iss_valor?: number | null;
          }> = [];

          if (r.source === 'erbon' && r.bookingInternalId) {
            const debits = await fetchErbonDebits(r.bookingInternalId, emitted);
            const services = debits.filter(e => isServiceEntry(e) && !isAcrescimo(e));
            const products = debits.filter(e => !isServiceEntry(e) || isAcrescimo(e));

            if (batchTipoNf === 'nfse') {
              if (services.length === 0) {
                failures.push({ label, error: 'Nenhum lançamento de serviço pendente na conta.' });
                continue;
              }
              const svcFiscal = await nfService.resolveServiceFiscalData(
                hotelId,
                services.map(e => ({ id: e.id, description: e.description, amount: e.amount })),
              ).catch(() => null);
              items = services.map(e => {
                const svc = svcFiscal?.items.find(s => s.erbon_entry_id === e.id);
                return {
                  erbon_entry_id: e.id,
                  descricao: e.description,
                  quantidade: 1,
                  valor_unitario: e.amount,
                  valor_total: e.amount,
                  codigo_servico: svc?.codigo_servico ?? null,
                  iss_aliquota: svc?.iss_aliquota ?? null,
                  iss_valor: svc?.iss_aliquota != null ? Math.round(e.amount * svc.iss_aliquota) / 100 : null,
                };
              });
            } else {
              if (products.length === 0) {
                failures.push({ label, error: 'Nenhum lançamento de produto pendente na conta.' });
                continue;
              }
              const realProducts = products.filter(e => !isAcrescimo(e));
              const fiscal = realProducts.length > 0
                ? await nfService.resolveEntryFiscalData(
                    hotelId,
                    realProducts.map(e => ({ id: e.id, description: e.description, amount: e.amount, idDepartment: e.idDepartment })),
                  )
                : { items: [], warnings: [], hasErrors: false };
              if (fiscal.hasErrors) {
                failures.push({ label, error: 'Dados fiscais dos produtos com pendências (NCM/tributação). Emita individualmente para revisar.' });
                continue;
              }
              items = products.map(e => {
                const f = fiscal.items.find(fi => fi.erbon_entry_id === e.id);
                const elig = isAcrescimo(e);
                return {
                  erbon_entry_id: e.id,
                  descricao: e.description,
                  quantidade: 1,
                  valor_unitario: e.amount,
                  valor_total: e.amount,
                  ...(!elig && f ? {
                    ncm: f.ncm || null,
                    cfop: '5102',
                    icms_aliquota: f.tax_percentage ?? null,
                    icms_valor: f.tax_percentage != null ? e.amount * (f.tax_percentage / 100) : null,
                  } : {}),
                };
              });
            }
          } else {
            // Reserva interna: lançamentos do catálogo de serviços
            if (batchTipoNf !== 'nfse') {
              failures.push({ label, error: 'Reserva interna: apenas NFS-e é suportada em lote.' });
              continue;
            }
            const charges = await fetchInternalCharges(r.raw.id);
            if (charges.length === 0) {
              failures.push({ label, error: 'Nenhum lançamento pendente de faturamento nesta reserva.' });
              continue;
            }
            internalChargeIds = charges.map((c: any) => c.id);
            const svcFiscal = await nfService.resolveServiceFiscalData(
              hotelId,
              charges.map((c: any, i: number) => ({ id: -(i + 1), description: c.description, amount: c.total, service_id: c.service_id })),
            ).catch(() => null);
            items = charges.map((c: any, i: number) => {
              const svc = svcFiscal?.items.find(s => s.erbon_entry_id === -(i + 1));
              return {
                erbon_entry_id: null,
                descricao: c.quantity !== 1 ? `${c.description} (${c.quantity}x)` : c.description,
                quantidade: 1,
                valor_unitario: c.total,
                valor_total: c.total,
                codigo_servico: svc?.codigo_servico ?? null,
                iss_aliquota: svc?.iss_aliquota ?? null,
                iss_valor: svc?.iss_aliquota != null ? Math.round(c.total * svc.iss_aliquota) / 100 : null,
              };
            });
          }

          const draft = await nfService.createDraftInvoice({
            hotel_id: hotelId,
            tipo: batchTipoNf,
            erbon_booking_id: r.bookingInternalId,
            booking_number: r.bookingNumber,
            room_description: r.roomDescription || null,
            tomador_nome: r.guestName,
            tomador_cpf_cnpj: r.guestDoc || '',
            tomador_doc_tipo: r.guestDocType || 'cpf',
            tomador_nacionalidade: r.guestNationality,
            tomador_email: r.guestEmail,
            tomador_endereco: null,
            items,
            emitido_por: null,
          });
          invoiceIds.push(draft.id);
          if (batchTipoNf === 'nfce') {
            const total = +items.reduce((s, i) => s + i.valor_total, 0).toFixed(2);
            pagamentosById[draft.id] = [{ tPag: batchTPag, vPag: total }];
          }
          if (r.source === 'internal' && internalChargeIds.length > 0) {
            chargesByInvoice[draft.id] = internalChargeIds;
          }
        } catch (err: any) {
          failures.push({ label, error: err.message || String(err) });
        }
      }

      // 2. Emite os rascunhos criados
      if (invoiceIds.length > 0) {
        const result = await nfService.batchEmitInvoices(invoiceIds, hotelId, setBatchProgress, 1000, pagamentosById);
        // Vincula lançamentos internos faturados às notas autorizadas
        for (const invId of result.successes) {
          const chargeIds = chargesByInvoice[invId];
          if (chargeIds?.length) {
            await supabase.from('internal_booking_charges').update({ invoice_id: invId }).in('id', chargeIds);
          }
        }
        result.failures.forEach(f => failures.push({ label: `Nota ${f.invoiceId.slice(0, 8)}`, error: f.error }));
        const okCount = result.successes.length;
        if (failures.length === 0) {
          addNotification('success', `Lote concluído: ${okCount} nota(s) emitida(s) com sucesso.`);
        } else {
          addNotification('warning', `Lote concluído: ${okCount} sucesso(s), ${failures.length} falha(s). ${failures.map(f => `${f.label}: ${f.error}`).join(' | ')}`);
        }
      } else {
        addNotification('error', `Nenhuma nota emitida. ${failures.map(f => `${f.label}: ${f.error}`).join(' | ')}`);
      }
      loadReservations();
    } catch (err: any) {
      addNotification('error', `Erro no lote: ${err.message}`);
    } finally {
      setBatchRunning(false);
      setBatchTipoNf(null);
      setBatchTPag('');
      setSelected(new Set());
    }
  };

  // ── Open single emission ───────────────────────────────────────────────────

  const handleOpenEmission = async (r: ClassifiedReservation, tipo: NFTipo) => {
    if (r.source === 'erbon' && r.bookingInternalId) {
      let entries: CurrentAccountEntry[] = [];
      try {
        const emitted = await nfService.getEmittedEntries(hotelId).catch(() => new Map<number, string>());
        entries = await fetchErbonDebits(r.bookingInternalId, emitted);
      } catch { /* conta corrente pode não estar disponível */ }
      setInvoiceModal({ booking: r, tipo, entries });
      return;
    }
    // Reserva interna: passa os lançamentos como itens genéricos (com service_id
    // do catálogo), igual ao fluxo do planning
    const charges = await fetchInternalCharges(r.raw.id).catch(() => []);
    const genericItems: GenericNFItem[] = charges.map((c: any, i: number) => ({
      id: -(i + 1),
      description: c.quantity !== 1 ? `${c.description} (${c.quantity}x)` : c.description,
      amount: c.total,
      service_id: c.service_id,
    }));
    if (genericItems.length === 0) {
      addNotification('error', 'Esta reserva interna não tem lançamentos pendentes de faturamento.');
      return;
    }
    setInvoiceModal({ booking: r, tipo, entries: [], genericItems, internalChargeIds: charges.map((c: any) => c.id) });
  };

  // ── Mark as adequate ───────────────────────────────────────────────────────

  const handleMarkAdequate = (id: string) => {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, tab: 'adequadas' as TabKey, issues: [], invoices: [] } : r));
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
              {can('nf.emit.nfse') && (
              <button onClick={() => handleBatchStart('nfse')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                <Zap className="w-4 h-4" /> Emitir NFS-e em Lote
              </button>
              )}
              {can('nf.emit.nfce') && (
              <button onClick={() => handleBatchStart('nfce')} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors">
                <Zap className="w-4 h-4" /> Emitir NFC-e em Lote
              </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Batch confirmation dialog */}
      {batchTipoNf && !batchRunning && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            Emitir {selected.size} {batchTipoNf === 'nfse' ? 'NFS-e' : 'NFC-e'}(s) em lote?
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            {batchTipoNf === 'nfse'
              ? 'Somente os lançamentos de serviço de cada conta entram na nota. As notas serão emitidas sequencialmente com intervalo de 1s.'
              : 'Somente os lançamentos de produto de cada conta entram na nota. As notas serão emitidas sequencialmente com intervalo de 1s.'}
          </p>
          {batchTipoNf === 'nfce' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">Forma de pagamento (obrigatória)</label>
              <select
                value={batchTPag}
                onChange={e => setBatchTPag(e.target.value)}
                className="text-sm border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800"
              >
                <option value="">Selecione...</option>
                {TPAG_OPTIONS.map(([code, lbl]) => <option key={code} value={code}>{lbl}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleBatchConfirm}
              disabled={batchTipoNf === 'nfce' && !batchTPag}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
            >Confirmar</button>
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
              canEmitNfse={can('nf.emit.nfse')}
              canEmitNfce={can('nf.emit.nfce')}
              onEmit={(tipo) => handleOpenEmission(r, tipo)}
              onViewNF={(invoiceId) => setViewerInvoiceId(invoiceId)}
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
          tipo={invoiceModal.tipo}
          hotelId={hotelId}
          booking={{
            bookingInternalID: invoiceModal.booking.bookingInternalId,
            erbonNumber: invoiceModal.booking.source === 'erbon' ? invoiceModal.booking.bookingNumber : null,
            roomDescription: invoiceModal.booking.roomDescription,
            guestList: [{
              name: invoiceModal.booking.guestName,
              email: invoiceModal.booking.guestEmail || '',
              phone: '',
              documents: invoiceModal.booking.guestDoc ? [{ documentType: invoiceModal.booking.guestDocType || 'cpf', number: invoiceModal.booking.guestDoc }] : [],
            }],
          }}
          selectedEntries={invoiceModal.entries}
          genericItems={invoiceModal.genericItems}
          onSuccess={async (invoiceId) => {
            // Reserva interna: vincula a nota aos lançamentos faturados
            if (invoiceId && invoiceModal.internalChargeIds?.length) {
              await supabase.from('internal_booking_charges')
                .update({ invoice_id: invoiceId })
                .in('id', invoiceModal.internalChargeIds);
            }
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
  canEmitNfse: boolean;
  canEmitNfce: boolean;
  onEmit: (tipo: NFTipo) => void;
  onViewNF: (invoiceId: string) => void;
  onMarkAdequate: () => void;
}

function ReservationCard({ reservation: r, activeTab, expanded, isSelected, onToggleExpand, onToggleSelect, canEmitNfse, canEmitNfce, onEmit, onViewNF, onMarkAdequate }: ReservationCardProps) {
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
          {activeTab === 'emitida' && r.invoices.length > 0 && (
            <div className="flex flex-col items-end gap-0.5">
              {r.invoices.map(inv => (
                <span key={inv.id} className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'} {inv.numero_nf ? `nº ${inv.numero_nf}` : ''}
                  {inv.status === 'contingencia' ? ' · contingência' : ''}
                </span>
              ))}
            </div>
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
            {activeTab === 'adequadas' && canEmitNfse && (
              <button onClick={() => onEmit('nfse')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                <FileText className="w-4 h-4" /> Emitir NFS-e (Serviços)
              </button>
            )}
            {activeTab === 'adequadas' && canEmitNfce && (
              <button onClick={() => onEmit('nfce')} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors">
                <FileText className="w-4 h-4" /> Emitir NFC-e (Consumidor)
              </button>
            )}
            {activeTab === 'revisao' && (
              <button onClick={onMarkAdequate} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors">
                <CheckCircle2 className="w-4 h-4" /> Marcar como Adequada
              </button>
            )}
            {activeTab === 'emitida' && (
              <>
                {r.invoices.map(inv => (
                  <React.Fragment key={inv.id}>
                    <button onClick={() => onViewNF(inv.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                      <Eye className="w-4 h-4" /> Ver {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'}{inv.numero_nf ? ` nº ${inv.numero_nf}` : ''}
                    </button>
                    {inv.xml_retorno && (
                      <button
                        onClick={() => {
                          const blob = new Blob([inv.xml_retorno!], { type: 'application/xml' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `NF_${inv.numero_nf || inv.id}.xml`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Download className="w-4 h-4" /> XML
                      </button>
                    )}
                  </React.Fragment>
                ))}
                {/* Emite apenas o tipo que ainda NÃO tem nota válida em produção;
                    os lançamentos já emitidos ficam de fora automaticamente */}
                {canEmitNfse && !r.invoices.some(inv => inv.tipo === 'nfse') && (
                  <button onClick={() => onEmit('nfse')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                    <FileText className="w-4 h-4" /> Emitir NFS-e (Serviços)
                  </button>
                )}
                {canEmitNfce && !r.invoices.some(inv => inv.tipo === 'nfce') && (
                  <button onClick={() => onEmit('nfce')} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors">
                    <FileText className="w-4 h-4" /> Emitir NFC-e (Consumidor)
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
