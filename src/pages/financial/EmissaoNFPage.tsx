import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Search, Loader2, CheckCircle2, AlertTriangle, FileCheck,
  ChevronDown, ChevronUp, Calendar, User, Building2, Filter,
  CheckSquare, Square, Zap, RefreshCw, Download, Eye, X, CreditCard,
} from 'lucide-react';
import { useHotel } from '../../context/HotelContext';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { erbonService, type ErbonBooking } from '../../lib/erbonService';
import { nfService, type BatchEmissionProgress, type WCIGuestData } from '../../lib/nfService';
import { PeriodFilter, defaultPeriod, type Period } from '../../components/financial/shared';
import { NFInvoiceModal, type CurrentAccountEntry, type GenericNFItem } from '../../components/nf/NFInvoiceModal';
import { matchesEligibleService, isHomologForTipo } from '../../lib/nfService';
import NFViewerModal from '../../components/nf/NFViewerModal';
import { NFAvulsaModal } from '../../components/nf/NFAvulsaModal';
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

type TabKey = 'adequadas' | 'revisao' | 'nfse_emitida' | 'nfce_emitida' | 'todas_emitida' | 'avulsas';
const isEmitidaTab = (tab: TabKey) => tab === 'nfse_emitida' || tab === 'nfce_emitida' || tab === 'todas_emitida';

interface EnrichedBatchReservation {
  reservation: ClassifiedReservation;
  tomador: {
    nome: string;
    cpfCnpj: string;
    docTipo: 'cpf' | 'cnpj' | 'passaporte';
    nacionalidade: string | null;
    email: string | null;
    /** Texto livre montado para as listagens e o PDF */
    endereco: string | null;
    // Endereço estruturado: é o que vira <end>/<endNac> no XML. Sem cep e
    // codigo_municipio o bloco é omitido em silêncio pelo builder da DPS.
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    codigoMunicipio: string | null;
  };
  resolvedTPag: string | null;
  resolvedTPagSource: string | null;
  issues: string[];
  warnings: string[];
  ready: boolean;
}

interface ClassifiedReservation extends UnifiedReservation {
  tab: TabKey;
  issues: string[];
  /** Notas válidas emitidas em produção para esta reserva (qualquer tela de origem) */
  invoices: NFInvoice[];
}

/** Pagamento (crédito) da reserva, extraído do contas a receber da Erbon */
interface PaymentInfo {
  id: number;
  method: string;      // descrição do crédito (ex.: "Integrado via Bee2Pay Rede Master Card")
  paymentType: string; // rótulo do título (ex.: "Cartão de Débito")
  value: number;
  date?: string;
}

// Mapeia a forma de pagamento da Erbon para o tPag da SEFAZ (NFC-e).
// A ordem importa: PIX antes de débito para "Pix Maquininha".
const ERBON_PAY_TO_TPAG: Array<[RegExp, string]> = [
  [/pix/i, '17'],
  [/d[eé]bito/i, '04'],
  [/cr[eé]dito/i, '03'],
  [/dinheiro|esp[eé]cie|cash/i, '01'],
  [/boleto/i, '15'],
  [/transfer|ted|doc|carteira/i, '18'],
];
function payToTPag(s?: string): string | null {
  if (!s) return null;
  for (const [re, code] of ERBON_PAY_TO_TPAG) if (re.test(s)) return code;
  return null;
}

// Constrói o mapa nºReserva → pagamentos a partir do contas a receber (uma
// chamada traz todos os títulos do hotel; filtramos os créditos não cancelados).
function buildPaymentsMap(arData: any[]): Map<string, PaymentInfo[]> {
  const map = new Map<string, PaymentInfo[]>();
  (arData || []).forEach((title: any) => {
    if (title.isCanceled) return;
    const bn = String(title.bookingNumber ?? '');
    if (!bn) return;
    for (const it of (title.currentAccountList || [])) {
      if (!it.iscredit || it.iscanceled) continue;
      const arr = map.get(bn) || [];
      if (arr.some(p => p.id === it.id)) continue;
      arr.push({
        id: it.id,
        method: it.description || title.paymentType || 'Pagamento',
        paymentType: title.paymentType || '',
        value: Number(it.valueTotal) || 0,
        date: title.emissionDate,
      });
      map.set(bn, arr);
    }
  });
  return map;
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
  const { user } = useAuth();
  const hotelId = selectedHotel?.id || '';
  const { can } = usePermissions();

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [filterBy, setFilterBy] = useState<'checkout' | 'checkin'>('checkout');
  const [loading, setLoading] = useState(false);
  const [reservations, setReservations] = useState<ClassifiedReservation[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('adequadas');

  // Pesquisa por nº de reserva / hóspede
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);

  // Formas de pagamento por nº de reserva (contas a receber Erbon)
  const [paymentsByBooking, setPaymentsByBooking] = useState<Map<string, PaymentInfo[]>>(new Map());

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
  const [viewerInvoice, setViewerInvoice] = useState<{ id: string; tipo: NFTipo } | null>(null);
  // NF avulsa (sem reserva)
  const [avulsaOpen, setAvulsaOpen] = useState(false);
  const [avulsas, setAvulsas] = useState<NFInvoice[]>([]);
  const [loadingAvulsas, setLoadingAvulsas] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchEmissionProgress | null>(null);
  const [batchTipoNf, setBatchTipoNf] = useState<NFTipo | null>(null);
  const [batchEnriched, setBatchEnriched] = useState<EnrichedBatchReservation[] | null>(null);
  const [batchEnriching, setBatchEnriching] = useState(false);
  const [batchEnrichProgress, setBatchEnrichProgress] = useState({ done: 0, total: 0 });
  // Reconsulta de NFS-e aceita mas ainda em processamento na Plataforma Nacional
  const [reconsultando, setReconsultando] = useState<string | null>(null);
  const [reconsultaMsg, setReconsultaMsg] = useState<string | null>(null);

  // ── Classificação (reutilizada pela carga por período e pela busca) ────────

  const buildClassified = useCallback(async (unified: UnifiedReservation[]): Promise<ClassifiedReservation[]> => {
    const [invoicesRes, nfConfig] = await Promise.all([
      supabase.from('nf_invoices')
        .select('*')
        .eq('hotel_id', hotelId)
        // 'emitida' = DPS aceita pelo municipio, aguardando numero/chave. Sem
        // isso a reserva volta para "Adequadas" e permite emitir nota duplicada.
        .in('status', ['autorizada', 'contingencia', 'emitida']),
      nfService.getConfig(hotelId),
    ]);

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

    return unified.map(r => {
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
        const hasNfse = blocking.some(inv => inv.tipo === 'nfse');
        const hasNfce = blocking.some(inv => inv.tipo === 'nfce' || inv.tipo === 'nfe');
        let tab: TabKey;
        if (hasNfse && hasNfce) tab = 'todas_emitida';
        else if (hasNfce) tab = 'nfce_emitida';
        else tab = 'nfse_emitida';
        return { ...r, tab, issues: [], invoices: blocking };
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
  }, [hotelId]);

  // ── Load reservations ─────────────────────────────────────────────────────

  const loadReservations = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    setSelected(new Set());
    setSearchTerm('');

    try {
      // Build array of dates in the period (Erbon API accepts one date per call)
      const dates: string[] = [];
      const dateKey = filterBy === 'checkout' ? 'checkout' : 'checkin';
      for (let d = new Date(period.from + 'T12:00:00'); d <= new Date(period.to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }

      // Fetch Erbon bookings for all dates in parallel, plus internal bookings
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

      const [internalRes, arData] = await Promise.all([
        supabase.from('internal_bookings')
          .select('*')
          .eq('hotel_id', hotelId)
          .eq('status', 'checkedout')
          .gte(filterBy === 'checkout' ? 'checkout' : 'checkin', period.from)
          .lte(filterBy === 'checkout' ? 'checkout' : 'checkin', period.to),
        erbonService.fetchAccountsReceivable(hotelId).catch(() => [] as any[]),
      ]);

      setPaymentsByBooking(buildPaymentsMap(arData as any[]));

      const unified: UnifiedReservation[] = [
        ...erbonBookings.map(erbonToUnified),
        ...(internalRes.data || []).map(internalToUnified),
      ];

      setReservations(await buildClassified(unified));
    } catch (err: any) {
      addNotification('error', `Erro ao carregar reservas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [hotelId, period, filterBy, addNotification, buildClassified]);

  // ── Busca ativa por nº de reserva na Erbon (fora do período carregado) ─────

  const handleSearchBooking = useCallback(async () => {
    const term = searchTerm.trim();
    if (!term) return;
    // Só dispara busca na Erbon para número de reserva (dígitos)
    if (!/^\d+$/.test(term)) return;
    setSearching(true);
    try {
      const found = await erbonService.searchBookings(hotelId, { bookingNumber: term });
      if (!found.length) {
        addNotification('info', `Nenhuma reserva #${term} encontrada na Erbon.`);
        return;
      }
      const classified = await buildClassified(found.map(erbonToUnified));

      // Completa as formas de pagamento das reservas encontradas
      const ar = await erbonService.fetchAccountsReceivable(hotelId).catch(() => [] as any[]);
      const freshPayments = buildPaymentsMap(ar as any[]);
      setPaymentsByBooking(prev => {
        const next = new Map(prev);
        for (const c of classified) {
          const p = freshPayments.get(c.bookingNumber);
          if (p) next.set(c.bookingNumber, p);
        }
        return next;
      });

      setReservations(prev => {
        const byId = new Map(prev.map(r => [r.id, r]));
        classified.forEach(c => byId.set(c.id, c));
        return [...byId.values()];
      });
      // Leva o usuário para a aba onde a reserva encontrada caiu
      setActiveTab(classified[0].tab);
      setSelected(new Set());
    } catch (err: any) {
      addNotification('error', `Erro na busca: ${err.message}`);
    } finally {
      setSearching(false);
    }
  }, [searchTerm, hotelId, addNotification, buildClassified]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  // ── Notas avulsas (sem reserva) ────────────────────────────────────────────

  const loadAvulsas = useCallback(async () => {
    if (!hotelId) return;
    setLoadingAvulsas(true);
    try {
      const { data } = await supabase
        .from('nf_invoices')
        .select('*')
        .eq('hotel_id', hotelId)
        .is('erbon_booking_id', null)
        .is('booking_number', null)
        .in('status', ['autorizada', 'contingencia', 'emitida'])
        .gte('created_at', period.from)
        .lte('created_at', period.to + 'T23:59:59')
        .order('created_at', { ascending: false });
      setAvulsas((data || []) as NFInvoice[]);
    } finally {
      setLoadingAvulsas(false);
    }
  }, [hotelId, period]);

  // NFS-e aceita pelo municipio mas ainda sem numero. Junta as duas origens
  // (reservas e avulsas): a avulsa nao passa pela classificacao em abas, entao
  // ficava sem nenhuma forma de reconsultar.
  const nfsePendentes = useMemo(() => {
    const temIdDps = (inv: NFInvoice) => !!inv.id_dps || !!inv.xml_retorno?.includes('idDPS');
    const pendente = (inv: NFInvoice) =>
      inv.tipo === 'nfse' && !inv.numero_nf && !inv.chave_acesso && temIdDps(inv);

    const daReserva = reservations.flatMap(r => r.invoices).filter(pendente);
    const avulsasPendentes = avulsas.filter(pendente);
    // Dedupe por id: a mesma nota pode aparecer nas duas listas
    const porId = new Map<string, NFInvoice>();
    [...daReserva, ...avulsasPendentes].forEach(inv => porId.set(inv.id, inv));
    return [...porId.values()];
  }, [reservations, avulsas]);

  const [reconsultandoLote, setReconsultandoLote] = useState<{ feitas: number; total: number } | null>(null);

  // Em lote, uma nota por vez. Em paralelo, varias consultas simultaneas ao
  // gateway do municipio aumentariam a chance de erro sem ganho real de tempo.
  const handleReconsultarTodas = useCallback(async () => {
    if (nfsePendentes.length === 0) return;
    setReconsultaMsg(null);
    setReconsultandoLote({ feitas: 0, total: nfsePendentes.length });
    let autorizadas = 0;
    let processando = 0;
    let falhas = 0;
    try {
      for (let i = 0; i < nfsePendentes.length; i++) {
        try {
          const res = await nfService.reconsultarDpsNacional(nfsePendentes[i].id);
          if (res.success && !res.processando) autorizadas++;
          else if (res.processando) processando++;
          else falhas++;
        } catch {
          falhas++;
        }
        setReconsultandoLote({ feitas: i + 1, total: nfsePendentes.length });
      }
      const partes = [`${autorizadas} autorizada(s)`];
      if (processando > 0) partes.push(`${processando} ainda em processamento`);
      if (falhas > 0) partes.push(`${falhas} com falha`);
      setReconsultaMsg(`Reconsulta concluída: ${partes.join(', ')}.`);
      if (autorizadas > 0) {
        await loadReservations();
        await loadAvulsas();
      }
    } finally {
      setReconsultandoLote(null);
    }
  }, [nfsePendentes, loadReservations, loadAvulsas]);

  const handleReconsultar = useCallback(async (invoiceId: string) => {
    setReconsultando(invoiceId);
    setReconsultaMsg(null);
    try {
      const res = await nfService.reconsultarDpsNacional(invoiceId);
      setReconsultaMsg(res.message);
      // Só recarrega quando a autorização chegou: se ainda está processando,
      // recarregar não muda nada e só faz a tela piscar.
      if (res.success && !res.processando) {
        await loadReservations();
        await loadAvulsas();
      }
    } catch (err) {
      setReconsultaMsg(err instanceof Error ? err.message : 'Falha na reconsulta.');
    } finally {
      setReconsultando(null);
    }
  }, [loadReservations, loadAvulsas]);

  useEffect(() => {
    loadAvulsas();
  }, [loadAvulsas]);

  // ── Tab counts ─────────────────────────────────────────────────────────────

  const tabCounts = useMemo(() => {
    const counts = { adequadas: 0, revisao: 0, nfse_emitida: 0, nfce_emitida: 0, todas_emitida: 0, avulsas: 0 };
    reservations.forEach(r => counts[r.tab]++);
    counts.avulsas = avulsas.length;
    return counts;
  }, [reservations, avulsas]);

  const termoBusca = searchTerm.trim().toLowerCase();

  const filtered = useMemo(
    () => reservations.filter(r => r.tab === activeTab && reservaCasa(r, termoBusca)),
    [reservations, activeTab, termoBusca],
  );

  // Busca em TODAS as abas, nao so na ativa. Sem isso, procurar uma reserva que
  // caiu em outra aba devolvia lista vazia, como se a reserva nao existisse.
  const matchesPorAba = useMemo(() => {
    const m = { adequadas: 0, revisao: 0, nfse_emitida: 0, nfce_emitida: 0, todas_emitida: 0, avulsas: 0 };
    if (!termoBusca) return m;
    reservations.forEach(r => { if (reservaCasa(r, termoBusca)) m[r.tab]++; });
    m.avulsas = avulsas.filter(inv => avulsaCasa(inv, termoBusca)).length;
    return m;
  }, [reservations, avulsas, termoBusca]);

  // Leva o usuario para a aba que tem o resultado. Depende so do termo: assim,
  // se ele trocar de aba na mao com a busca ativa, nao e arrastado de volta.
  useEffect(() => {
    if (!termoBusca) return;
    const total = Object.values(matchesPorAba).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    setActiveTab(atual => {
      if (matchesPorAba[atual] > 0) return atual;
      const destino = (Object.keys(matchesPorAba) as TabKey[]).find(k => matchesPorAba[k] > 0);
      return destino ?? atual;
    });
    // matchesPorAba deriva do termo; incluir na lista de dependencias faria a
    // aba ser reavaliada a cada recarga de reservas, brigando com o usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termoBusca]);

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

  const formatWCIAddress = (wci: WCIGuestData): string | null => {
    if (!wci.address_street?.trim()) return null;
    const logradouro = wci.address_number
      ? `${wci.address_street}, ${wci.address_number}`
      : wci.address_street;
    const parts = [wci.address_complement ? `${logradouro} - ${wci.address_complement}` : logradouro];
    if (wci.address_neighborhood) parts.push(wci.address_neighborhood);
    if (wci.address_city && wci.address_state) parts.push(`${wci.address_city} - ${wci.address_state}`);
    else if (wci.address_city) parts.push(wci.address_city);
    if (wci.address_zipcode) parts.push(`CEP ${wci.address_zipcode}`);
    return parts.join(', ');
  };

  /**
   * Completa cidade, UF e código IBGE a partir do CEP (ViaCEP). Fichas antigas
   * não têm address_city_ibge, e sem cMun a DPS da NFS-e Nacional é rejeitada.
   */
  const resolveCepIbge = async (cep: string | null): Promise<{ cidade: string | null; uf: string | null; ibge: string | null }> => {
    const digits = (cep || '').replace(/\D/g, '');
    if (digits.length !== 8) return { cidade: null, uf: null, ibge: null };
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) return { cidade: null, uf: null, ibge: null };
      const data = await res.json();
      if (data.erro) return { cidade: null, uf: null, ibge: null };
      return {
        cidade: data.localidade || null,
        uf: data.uf || null,
        ibge: data.ibge ? String(data.ibge) : null,
      };
    } catch {
      return { cidade: null, uf: null, ibge: null };
    }
  };

  const enrichBatchReservations = async (selectedRes: ClassifiedReservation[], tipo: NFTipo): Promise<EnrichedBatchReservation[]> => {
    setBatchEnriching(true);
    const total = selectedRes.length;
    setBatchEnrichProgress({ done: 0, total });

    let done = 0;
    const wciResults = await Promise.allSettled(
      selectedRes.map(r =>
        nfService.lookupWCIGuest(hotelId, r.bookingNumber, r.guestName)
          .finally(() => { done++; setBatchEnrichProgress({ done, total }); })
      )
    );

    // Preenche o código do município das fichas que não têm (uma consulta por
    // CEP distinto, para não repetir chamada em reservas do mesmo endereço).
    const cepsSemIbge = Array.from(new Set(
      wciResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter(w => w && w.address_zipcode && !w.address_city_ibge)
        .map(w => w!.address_zipcode as string)
    ));
    const ibgePorCep = new Map<string, { cidade: string | null; uf: string | null; ibge: string | null }>();
    for (const cep of cepsSemIbge) {
      ibgePorCep.set(cep, await resolveCepIbge(cep));
    }

    const enriched: EnrichedBatchReservation[] = selectedRes.map((r, i) => {
      const wci = wciResults[i].status === 'fulfilled' ? wciResults[i].value : null;
      const issues: string[] = [];
      const warnings: string[] = [];

      // Merge tomador: WCI overlays Erbon
      const wciDocTipo = wci?.document_type?.toLowerCase() || '';
      let docTipo: 'cpf' | 'cnpj' | 'passaporte' = r.guestDocType || 'cpf';
      let cpfCnpj = r.guestDoc || '';
      if (wci?.document_number) {
        cpfCnpj = wci.document_number;
        if (wciDocTipo.includes('cnpj')) docTipo = 'cnpj';
        else if (wciDocTipo.includes('passaporte') || wciDocTipo.includes('passport')) docTipo = 'passaporte';
        else docTipo = 'cpf';
      }

      const nome = wci?.name || r.guestName;
      const nacionalidade = wci?.nationality || r.guestNationality || null;
      const email = wci?.email || r.guestEmail || null;
      const endereco = wci ? formatWCIAddress(wci) : null;

      // Endereço estruturado (o texto acima serve só para tela e PDF)
      const cepFicha = wci?.address_zipcode || null;
      const viaCep = cepFicha ? ibgePorCep.get(cepFicha) : undefined;
      const codigoMunicipio = wci?.address_city_ibge || viaCep?.ibge || null;
      const cidade = wci?.address_city || viaCep?.cidade || null;
      const uf = wci?.address_state || viaCep?.uf || null;

      if (!wci) warnings.push('Ficha de check-in não encontrada, usando dados da reserva');

      // Resolve tPag from Erbon payments
      let resolvedTPag: string | null = null;
      let resolvedTPagSource: string | null = null;
      if (tipo === 'nfce') {
        const pays = paymentsByBooking.get(r.bookingNumber) || [];
        const codes = pays
          .map(p => ({ code: payToTPag(p.paymentType) || payToTPag(p.method), label: p.paymentType || p.method }))
          .filter(c => c.code);
        const uniqueCodes = new Set(codes.map(c => c.code));
        if (uniqueCodes.size === 1) {
          resolvedTPag = codes[0].code!;
          resolvedTPagSource = codes[0].label;
        } else if (uniqueCodes.size > 1) {
          warnings.push('Múltiplas formas de pagamento detectadas');
        }
        if (!resolvedTPag) {
          issues.push('Forma de pagamento não detectada');
        }
      }

      // NFS-e requires document
      if (tipo === 'nfse' && !cpfCnpj) {
        issues.push('Documento do tomador ausente (obrigatório para NFS-e)');
      }

      // NFS-e Nacional exige o endereço do tomador com número e código IBGE do
      // município. Faltando qualquer um deles o builder omite o bloco <end> sem
      // avisar, e a nota sai sem endereço: melhor barrar aqui e emitir pelo modal.
      if (tipo === 'nfse') {
        if (!wci?.address_street) {
          issues.push('Endereço do tomador ausente na ficha de check-in');
        } else if (!wci.address_number) {
          issues.push('Número do endereço ausente na ficha de check-in');
        } else if (!codigoMunicipio || !cepFicha) {
          issues.push('CEP ou código do município do tomador não resolvido');
        }
      }

      return {
        reservation: r,
        tomador: {
          nome, cpfCnpj, docTipo, nacionalidade, email, endereco,
          logradouro:      wci?.address_street     || null,
          numero:          wci?.address_number     || null,
          complemento:     wci?.address_complement || null,
          bairro:          wci?.address_neighborhood || null,
          cidade,
          uf,
          cep:             cepFicha,
          codigoMunicipio,
        },
        resolvedTPag,
        resolvedTPagSource,
        issues,
        warnings,
        ready: issues.length === 0,
      };
    });

    setBatchEnriching(false);
    return enriched;
  };

  const handleBatchStart = async (tipo: NFTipo) => {
    setBatchTipoNf(tipo);
    const selectedRes = filtered.filter(r => selected.has(r.id));
    const enriched = await enrichBatchReservations(selectedRes, tipo);
    setBatchEnriched(enriched);
  };

  // Busca os lançamentos de débito FATURADOS da conta corrente Erbon
  // (excluindo já emitidos). Só itens com isInvoiced=true entram na NF —
  // os não faturados ainda não foram pagos/fechados e não devem gerar nota.
  const fetchErbonDebits = async (bookingInternalId: number, emitted: Map<number, string>): Promise<CurrentAccountEntry[]> => {
    const account = await erbonService.fetchBookingAccount(hotelId, bookingInternalId);
    return (account || [])
      .filter((e: any) => e.isDebit && e.isInvoiced && !emitted.has(e.id))
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

  const handleBatchConfirm = async (enrichedList: EnrichedBatchReservation[]) => {
    if (!batchTipoNf) return;
    const readyItems = enrichedList.filter(e => e.ready);
    if (readyItems.length === 0) return;

    setBatchRunning(true);
    setBatchProgress(null);

    const failures: Array<{ label: string; error: string }> = [];
    const invoiceIds: string[] = [];
    const pagamentosById: Record<string, { tPag: string; vPag: number }[]> = {};
    const chargesByInvoice: Record<string, string[]> = {};

    try {
      const [nfceEligible, emitted, erbonMappings] = await Promise.all([
        nfService.getNfceEligibleServices(hotelId).catch(() => []),
        nfService.getEmittedEntries(hotelId).catch(() => new Map<number, string>()),
        nfService.getErbonMappingIndex(hotelId).catch(() => []),
      ]);
      const isAcrescimo = (e: { description: string }) =>
        nfceEligible.some(s => matchesEligibleService(e.description, s));
      // Classificação produto/serviço: mapeamento Erbon (com preferência de
      // departamento) tem prioridade sobre a heurística de palavra-chave.
      const isServiceMapped = (e: { description: string; idDepartment?: number }) =>
        nfService.isServiceEntryMapped(e, erbonMappings);

      for (const enriched of readyItems) {
        const r = enriched.reservation;
        const label = `${r.guestName} (#${r.bookingNumber})`;
        try {
          let internalChargeIds: string[] = [];
          let items: Array<{
            erbon_entry_id: number | null; descricao: string; quantidade: number;
            valor_unitario: number; valor_total: number;
            ncm?: string | null; cfop?: string | null; icms_aliquota?: number | null; icms_valor?: number | null;
            codigo_servico?: string | null; iss_aliquota?: number | null; iss_valor?: number | null;
          }> = [];

          if (r.source === 'erbon' && r.bookingInternalId) {
            const debits = await fetchErbonDebits(r.bookingInternalId, emitted);
            const services = debits.filter(e => isServiceMapped(e) && !isAcrescimo(e));
            const products = debits.filter(e => !isServiceMapped(e) || isAcrescimo(e));

            if (batchTipoNf === 'nfse') {
              if (services.length === 0) {
                failures.push({ label, error: 'Nenhum lançamento de serviço pendente na conta.' });
                continue;
              }
              const svcFiscal = await nfService.resolveServiceFiscalData(
                hotelId,
                services.map(e => ({ id: e.id, description: e.description, amount: e.amount, idDepartment: e.idDepartment })),
                erbonMappings,
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
                    erbonMappings,
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
                    cfop: f.cfop || '5102',
                    icms_aliquota: f.tax_percentage ?? null,
                    icms_valor: f.tax_percentage != null ? e.amount * (f.tax_percentage / 100) : null,
                    pis_cst: f.pis_cst ?? null,
                    pis_aliquota: f.pis_aliquota ?? null,
                    cofins_cst: f.cofins_cst ?? null,
                    cofins_aliquota: f.cofins_aliquota ?? null,
                    ibs_cbs_cst: f.ibs_cbs_cst ?? null,
                    ibs_cbs_cclasstrib: f.ibs_cbs_cclasstrib ?? null,
                    ibs_aliquota: f.ibs_aliquota ?? null,
                    cbs_aliquota: f.cbs_aliquota ?? null,
                  } : {}),
                };
              });
            }
          } else {
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
            tomador_nome: enriched.tomador.nome,
            tomador_cpf_cnpj: enriched.tomador.cpfCnpj,
            tomador_doc_tipo: enriched.tomador.docTipo,
            tomador_nacionalidade: enriched.tomador.nacionalidade,
            tomador_email: enriched.tomador.email,
            tomador_endereco: enriched.tomador.endereco,
            // Estruturado: é daqui que sai o <end>/<endNac> do XML. Sem isso a
            // nota do lote saía sempre sem endereço, mesmo com ficha completa.
            tomador_logradouro: enriched.tomador.logradouro,
            tomador_numero: enriched.tomador.numero,
            tomador_complemento: enriched.tomador.complemento,
            tomador_bairro: enriched.tomador.bairro,
            tomador_cidade: enriched.tomador.cidade,
            tomador_uf: enriched.tomador.uf,
            tomador_cep: enriched.tomador.cep,
            tomador_codigo_municipio: enriched.tomador.codigoMunicipio,
            items,
            emitido_por: user?.id || null,
          });
          invoiceIds.push(draft.id);
          if (batchTipoNf === 'nfce' && enriched.resolvedTPag) {
            const total = +items.reduce((s, it) => s + it.valor_total, 0).toFixed(2);
            pagamentosById[draft.id] = [{ tPag: enriched.resolvedTPag, vPag: total }];
          }
          if (r.source === 'internal' && internalChargeIds.length > 0) {
            chargesByInvoice[draft.id] = internalChargeIds;
          }
        } catch (err: any) {
          failures.push({ label, error: err.message || String(err) });
        }
      }

      if (invoiceIds.length > 0) {
        const result = await nfService.batchEmitInvoices(invoiceIds, hotelId, setBatchProgress, 1000, pagamentosById);
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
      setBatchEnriched(null);
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
    { key: 'nfse_emitida', label: 'NFS-e Emitida', icon: <FileCheck className="w-4 h-4" />, color: 'violet', count: tabCounts.nfse_emitida },
    { key: 'nfce_emitida', label: 'NFC-e Emitida', icon: <FileCheck className="w-4 h-4" />, color: 'purple', count: tabCounts.nfce_emitida },
    { key: 'todas_emitida', label: 'Todas NF', icon: <FileCheck className="w-4 h-4" />, color: 'blue', count: tabCounts.todas_emitida },
    { key: 'avulsas', label: 'Avulsas', icon: <FileText className="w-4 h-4" />, color: 'teal', count: tabCounts.avulsas },
  ];

  // Com busca ativa, o contador mostra os RESULTADOS por aba, nao o total do
  // periodo. E o que responde "em qual aba esta essa reserva" de imediato.
  const abasVisiveis = termoBusca
    ? tabs.map(t => ({ ...t, count: matchesPorAba[t.key] }))
    : tabs;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Resultado da reconsulta de NFS-e pendente na Plataforma Nacional */}
      {reconsultaMsg && (
        <div className="mb-4 p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 flex items-start justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-300">{reconsultaMsg}</p>
          <button onClick={() => setReconsultaMsg(null)} className="text-amber-700 dark:text-amber-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">Emissão de NF</h1>
        </div>
        <div className="flex-1" />
        {(can('nf.emit.nfse') || can('nf.emit.nfce')) && (
          <button onClick={() => setAvulsaOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold transition-colors">
            <FileText className="w-4 h-4" /> Nova NF
          </button>
        )}
        {nfsePendentes.length > 0 && (
          <button
            onClick={handleReconsultarTodas}
            disabled={!!reconsultandoLote}
            title="Busca o número na prefeitura de todas as NFS-e que estão aguardando autorização"
            className="flex items-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${reconsultandoLote ? 'animate-spin' : ''}`} />
            {reconsultandoLote
              ? `Reconsultando ${reconsultandoLote.feitas}/${reconsultandoLote.total}…`
              : `Reconsultar ${nfsePendentes.length} NFS-e pendente${nfsePendentes.length > 1 ? 's' : ''}`}
          </button>
        )}
        <button onClick={() => { loadReservations(); loadAvulsas(); }} disabled={loading} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
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

        {/* Busca por nº de reserva / hóspede */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearchBooking(); }}
              placeholder="Nº da reserva ou hóspede…"
              className="w-56 text-sm border border-gray-300 dark:border-gray-600 rounded-lg pl-8 pr-8 py-1.5 bg-white dark:bg-gray-800"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                title="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={handleSearchBooking}
            disabled={searching || !/^\d+$/.test(searchTerm.trim())}
            title="Buscar este nº de reserva na Erbon (mesmo fora do período)"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar na Erbon
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {abasVisiveis.map(t => {
          const active = activeTab === t.key;
          const colorMap: Record<string, string> = {
            green: active ? 'bg-green-500 text-white' : 'text-green-700 dark:text-green-400',
            amber: active ? 'bg-amber-500 text-white' : 'text-amber-700 dark:text-amber-400',
            blue: active ? 'bg-blue-500 text-white' : 'text-blue-700 dark:text-blue-400',
            violet: active ? 'bg-violet-500 text-white' : 'text-violet-700 dark:text-violet-400',
            purple: active ? 'bg-purple-500 text-white' : 'text-purple-700 dark:text-purple-400',
            teal: active ? 'bg-teal-500 text-white' : 'text-teal-700 dark:text-teal-400',
          };
          return (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setSelected(new Set()); }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${active ? colorMap[t.color] + ' shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'} ${termoBusca && t.count === 0 && !active ? 'opacity-40' : ''}`}
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

      {/* Batch Review Modal */}
      {batchTipoNf && !batchRunning && (
        <BatchReviewModal
          tipo={batchTipoNf}
          enriching={batchEnriching}
          enrichProgress={batchEnrichProgress}
          enriched={batchEnriched}
          userName={user?.email || user?.user_metadata?.full_name || 'Usuário'}
          onUpdateEnriched={setBatchEnriched}
          onConfirm={handleBatchConfirm}
          onCancel={() => { setBatchTipoNf(null); setBatchEnriched(null); }}
        />
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

      {/* Lista de notas avulsas (sem reserva) */}
      {activeTab === 'avulsas' ? (
        loadingAvulsas ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            <span className="ml-3 text-gray-500">Carregando notas avulsas...</span>
          </div>
        ) : avulsas.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg">Nenhuma NF avulsa emitida no período.</p>
            <p className="text-sm mt-1">Use o botão "Nova NF" para emitir sem vínculo com reserva.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {avulsas
              .filter(inv => avulsaCasa(inv, termoBusca))
              .map(inv => (
                <div key={inv.id} className="bg-white dark:bg-gray-800 border border-teal-200 dark:border-teal-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    inv.tipo === 'nfse'
                      ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400'
                      : 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400'
                  }`}>
                    {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'}
                    {inv.numero_nf ? ` nº ${inv.numero_nf}` : ''}
                  </span>
                  {inv.status === 'contingencia' && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">contingência</span>
                  )}
                  {inv.status === 'emitida' && !inv.numero_nf && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">aguardando número</span>
                  )}
                  <div className="flex-1 min-w-[140px]">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{inv.tomador_nome || 'Consumidor final'}</span>
                    <span className="block text-xs text-gray-400">
                      {new Date(inv.created_at).toLocaleDateString('pt-BR')} às {new Date(inv.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {inv.tomador_cpf_cnpj ? ` · ${inv.tomador_cpf_cnpj}` : ''}
                    </span>
                  </div>
                  <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
                    R$ {Number(inv.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewerInvoice({ id: inv.id, tipo: inv.tipo })}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <Eye className="w-4 h-4" /> Ver
                    </button>
                    {/* A avulsa nao passa pela classificacao em abas, entao o
                        botao da linha da reserva nao a alcancava: sem isto ela
                        ficava sem nenhuma forma de buscar o numero. */}
                    {inv.tipo === 'nfse' && !inv.numero_nf && !inv.chave_acesso && (inv.id_dps || inv.xml_retorno?.includes('idDPS')) && (
                      <button
                        onClick={() => handleReconsultar(inv.id)}
                        disabled={reconsultando === inv.id}
                        title="Busca o número da NFS-e na prefeitura"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                      >
                        <RefreshCw className={`w-4 h-4 ${reconsultando === inv.id ? 'animate-spin' : ''}`} /> Reconsultar
                      </button>
                    )}
                    {inv.xml_retorno && (
                      <button
                        onClick={() => {
                          const ehXml = inv.xml_retorno!.trimStart().startsWith('<');
                          baixarArquivo(
                            inv.xml_retorno!,
                            `NF_${inv.numero_nf || inv.id}.${ehXml ? 'xml' : 'json'}`,
                            ehXml ? 'application/xml' : 'application/json',
                          );
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        {inv.xml_retorno.trimStart().startsWith('<') ? 'XML' : 'Retorno da API'}
                      </button>
                    )}
                    {inv.xml_dps && (
                      <button
                        onClick={() => baixarArquivo(inv.xml_dps!, `DPS_${inv.numero_nf || inv.id}.xml`, 'application/xml')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                        title="XML assinado enviado à Plataforma Nacional, com o bloco IBS/CBS declarado."
                      >
                        <Download className="w-4 h-4" /> DPS
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="ml-3 text-gray-500">Carregando reservas...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg">Nenhuma reserva {isEmitidaTab(activeTab) ? 'com NF emitida' : activeTab === 'revisao' ? 'para revisão' : 'pronta para emissão'} no período.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <ReservationCard
              key={r.id}
              reservation={r}
              payments={paymentsByBooking.get(r.bookingNumber) || []}
              activeTab={activeTab}
              expanded={expandedId === r.id}
              isSelected={selected.has(r.id)}
              onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onToggleSelect={() => toggleSelect(r.id)}
              canEmitNfse={can('nf.emit.nfse')}
              canEmitNfce={can('nf.emit.nfce')}
              onEmit={(tipo) => handleOpenEmission(r, tipo)}
              onViewNF={(invoiceId, tipo) => setViewerInvoice({ id: invoiceId, tipo: tipo || 'nfse' })}
              onReconsultar={handleReconsultar}
              reconsultandoId={reconsultando}
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
          // Reserva interna também tem ficha de web check-in: o nº da reserva
          // vai por prop separada para o lookup do tomador não depender da Erbon
          wciBookingNumber={invoiceModal.booking.bookingNumber}
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

      {/* NF avulsa (sem reserva) */}
      {avulsaOpen && (
        <NFAvulsaModal
          isOpen
          hotelId={hotelId}
          canNfse={can('nf.emit.nfse')}
          canNfce={can('nf.emit.nfce')}
          onClose={() => setAvulsaOpen(false)}
          onEmitted={() => { loadAvulsas(); setActiveTab('avulsas'); }}
          onView={(id, tipo) => setViewerInvoice({ id, tipo })}
        />
      )}

      {/* NF Viewer: NFC-e abre cupom fiscal (NFInvoiceModal view); NFS-e/NF-e abre A4 */}
      {viewerInvoice && viewerInvoice.tipo === 'nfce' && (
        <NFInvoiceModal
          isOpen
          onClose={() => setViewerInvoice(null)}
          tipo="nfce"
          hotelId={hotelId}
          booking={{}}
          selectedEntries={[]}
          viewInvoiceId={viewerInvoice.id}
          onSuccess={() => setViewerInvoice(null)}
        />
      )}
      {viewerInvoice && viewerInvoice.tipo !== 'nfce' && (
        <NFViewerModal
          isOpen
          onClose={() => setViewerInvoice(null)}
          invoiceId={viewerInvoice.id}
          hotelId={hotelId}
        />
      )}
    </div>
  );
}

// ── Reservation Card ─────────────────────────────────────────────────────────

interface ReservationCardProps {
  reservation: ClassifiedReservation;
  payments: PaymentInfo[];
  activeTab: TabKey;
  expanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  canEmitNfse: boolean;
  canEmitNfce: boolean;
  onEmit: (tipo: NFTipo) => void;
  onViewNF: (invoiceId: string, tipo?: NFTipo) => void;
  onReconsultar: (invoiceId: string) => void;
  reconsultandoId: string | null;
  onMarkAdequate: () => void;
}

// Download de arquivo gerado no cliente. Extensão e MIME vêm de fora porque o
// mesmo campo pode carregar XML ou JSON, dependendo do estágio da nota.
// Predicados de busca. Compartilhados entre a lista da aba ativa, a contagem
// por aba e o salto automatico, para que "encontrar" signifique a mesma coisa
// nos tres lugares.
function reservaCasa(r: ClassifiedReservation, termo: string): boolean {
  if (!termo) return true;
  return r.bookingNumber.toLowerCase().includes(termo)
    || r.guestName.toLowerCase().includes(termo)
    || (r.guestDoc || '').toLowerCase().includes(termo);
}

function avulsaCasa(inv: NFInvoice, termo: string): boolean {
  if (!termo) return true;
  return (inv.tomador_nome || '').toLowerCase().includes(termo)
    || (inv.numero_nf || '').toLowerCase().includes(termo)
    || (inv.tomador_cpf_cnpj || '').toLowerCase().includes(termo);
}

function baixarArquivo(conteudo: string, nomeArquivo: string, mime: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

function ReservationCard({ reservation: r, payments, activeTab, expanded, isSelected, onToggleExpand, onToggleSelect, canEmitNfse, canEmitNfce, onEmit, onViewNF, onReconsultar, reconsultandoId, onMarkAdequate }: ReservationCardProps) {
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
  };
  const fmtMoney = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  // Rótulos resumidos das formas de pagamento (para o badge do cabeçalho)
  const payLabels = Array.from(new Set(payments.map(p => p.paymentType).filter(Boolean)));

  return (
    <div className={`border rounded-xl transition-all ${
      isEmitidaTab(activeTab) ? 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10'
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
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {r.roomDescription}</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(r.checkIn)} → {fmtDate(r.checkOut)}</span>
            {r.guestDoc && <span>{r.guestDocType === 'cnpj' ? 'CNPJ' : r.guestDocType === 'passaporte' ? 'Pass.' : 'CPF'}: {r.guestDoc}</span>}
            {payLabels.map((lbl, i) => (
              <span key={i} className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CreditCard className="w-3 h-3" /> {lbl}
              </span>
            ))}
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
          {isEmitidaTab(activeTab) && r.invoices.length > 0 && (
            <div className="flex flex-col items-end gap-0.5">
              {r.invoices.map(inv => (
                <span key={inv.id} className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'} {inv.numero_nf ? `nº ${inv.numero_nf}` : ''}
                  {inv.status === 'contingencia' ? ' · contingência' : ''}
                  {inv.status === 'emitida' && !inv.numero_nf ? ' · aguardando número' : ''}
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
            <div><span className="text-gray-500 text-xs">Valor Total</span><br /><span className="font-medium">{fmtMoney(r.totalValue)}</span></div>
          </div>

          {/* Formas de pagamento (contas a receber Erbon) */}
          {payments.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Formas de pagamento
              </p>
              <div className="space-y-1">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-600 dark:text-gray-300 truncate">
                      {p.method}
                      {p.paymentType && p.paymentType !== p.method && (
                        <span className="text-gray-400"> · {p.paymentType}</span>
                      )}
                    </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{fmtMoney(p.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            {isEmitidaTab(activeTab) && (
              <>
                {r.invoices.map(inv => (
                  <React.Fragment key={inv.id}>
                    <button onClick={() => onViewNF(inv.id, inv.tipo)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                      <Eye className="w-4 h-4" /> Ver {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'}{inv.numero_nf ? ` nº ${inv.numero_nf}` : ''}
                    </button>
                    {/* A Plataforma Nacional pode aceitar a DPS e ainda estar
                        processando a NFS-e: nesse caso a nota fica sem número e
                        sem chave, e só a reconsulta completa os dados. */}
                    {inv.tipo === 'nfse' && (inv.id_dps || inv.xml_retorno?.includes('idDPS')) && !inv.chave_acesso && !inv.numero_nf && (
                      <button
                        onClick={() => onReconsultar(inv.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                        title="A NFS-e foi aceita, mas ainda está em processamento na Plataforma Nacional. Reconsulte para trazer número, chave e XML autorizado."
                      >
                        <RefreshCw className={`w-4 h-4 ${reconsultandoId === inv.id ? 'animate-spin' : ''}`} /> Reconsultar NFS-e
                      </button>
                    )}
                    {/* `xml_retorno` nem sempre é XML: enquanto a NFS-e Nacional
                        está em processamento, a API devolve um JSON de
                        acompanhamento. Baixar isso como .xml gerava um arquivo
                        que o navegador recusa ("'<' not found"), então o
                        conteúdo é detectado antes de nomear o arquivo. */}
                    {inv.xml_retorno && (
                      <button
                        onClick={() => {
                          const ehXml = inv.xml_retorno!.trimStart().startsWith('<');
                          baixarArquivo(
                            inv.xml_retorno!,
                            `NF_${inv.numero_nf || inv.id}.${ehXml ? 'xml' : 'json'}`,
                            ehXml ? 'application/xml' : 'application/json',
                          );
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        {inv.xml_retorno.trimStart().startsWith('<') ? 'XML da nota' : 'Retorno da API'}
                      </button>
                    )}
                    {/* DPS assinada que foi enviada: é aqui que se confere o que
                        de fato declaramos, incluindo o bloco <IBSCBS>. */}
                    {inv.xml_dps && (
                      <button
                        onClick={() => baixarArquivo(inv.xml_dps!, `DPS_${inv.numero_nf || inv.id}.xml`, 'application/xml')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                        title="XML assinado que foi enviado à Plataforma Nacional, com o bloco IBS/CBS declarado."
                      >
                        <Download className="w-4 h-4" /> XML enviado (DPS)
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

// ── Batch Review Modal ──────────────────────────────────────────────────────

interface BatchReviewModalProps {
  tipo: NFTipo;
  enriching: boolean;
  enrichProgress: { done: number; total: number };
  enriched: EnrichedBatchReservation[] | null;
  userName: string;
  onUpdateEnriched: (updated: EnrichedBatchReservation[]) => void;
  onConfirm: (enriched: EnrichedBatchReservation[]) => void;
  onCancel: () => void;
}

function BatchReviewModal({ tipo, enriching, enrichProgress, enriched, userName, onUpdateEnriched, onConfirm, onCancel }: BatchReviewModalProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const fmtMoney = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const tipoLabel = tipo === 'nfse' ? 'NFS-e' : tipo === 'nfce' ? 'NFC-e' : 'NF-e';

  const readyCount = enriched?.filter(e => e.ready).length || 0;
  const issueCount = enriched ? enriched.length - readyCount : 0;
  const totalValue = enriched?.reduce((s, e) => s + e.reservation.totalValue, 0) || 0;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const updateItem = (index: number, patch: Partial<EnrichedBatchReservation>) => {
    if (!enriched) return;
    const updated = [...enriched];
    const item = { ...updated[index], ...patch };
    // Recalculate readiness
    const issues: string[] = [];
    if (tipo === 'nfce' && !item.resolvedTPag) issues.push('Forma de pagamento não detectada');
    if (tipo === 'nfse' && !item.tomador.cpfCnpj) issues.push('Documento do tomador ausente (obrigatório para NFS-e)');
    item.issues = issues;
    item.ready = issues.length === 0;
    updated[index] = item;
    onUpdateEnriched(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Revisao do Lote — {enriched?.length || enrichProgress.total} {tipoLabel}
            </h2>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Enrichment progress */}
        {enriching && (
          <div className="px-6 py-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Consultando fichas de check-in... ({enrichProgress.done}/{enrichProgress.total})
            </p>
            <div className="w-full max-w-xs mx-auto bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-3">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${enrichProgress.total > 0 ? (enrichProgress.done / enrichProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary bar + list */}
        {!enriching && enriched && (
          <>
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4 flex-wrap text-sm">
              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> {readyCount} pronta(s)
              </span>
              {issueCount > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                  <AlertTriangle className="w-4 h-4" /> {issueCount} com pendencia(s)
                </span>
              )}
              <span className="text-gray-500 ml-auto font-semibold">{fmtMoney(totalValue)}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
              {enriched.map((item, idx) => {
                const r = item.reservation;
                const isExpanded = expandedIds.has(r.id) || !item.ready;
                return (
                  <div
                    key={r.id}
                    className={`border rounded-xl transition-all ${
                      item.ready
                        ? 'border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10'
                        : 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10'
                    }`}
                  >
                    {/* Collapsed row */}
                    <div
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                      onClick={() => item.ready && toggleExpand(r.id)}
                    >
                      {item.ready
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      }
                      <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{item.tomador.nome}</span>
                      <span className="text-xs text-gray-500">#{r.bookingNumber}</span>
                      <span className="text-xs text-gray-500">{r.roomDescription}</span>
                      <span className="ml-auto font-semibold text-sm text-gray-900 dark:text-white whitespace-nowrap">
                        {fmtMoney(r.totalValue)}
                      </span>
                      {tipo === 'nfce' && item.resolvedTPag && (
                        <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                          {TPAG_OPTIONS.find(([c]) => c === item.resolvedTPag)?.[1] || item.resolvedTPag}
                        </span>
                      )}
                      {item.tomador.endereco && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">WCI</span>
                      )}
                      {item.ready && (
                        isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3">
                        {/* Issues */}
                        {item.issues.length > 0 && (
                          <div className="space-y-1">
                            {item.issues.map((issue, i) => (
                              <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> {issue}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Warnings */}
                        {item.warnings.length > 0 && (
                          <div className="space-y-0.5">
                            {item.warnings.map((w, i) => (
                              <p key={i} className="text-xs text-gray-500 italic">{w}</p>
                            ))}
                          </div>
                        )}

                        {/* Tomador info grid */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-gray-500 text-xs">Nome</span>
                            <p className="font-medium text-gray-900 dark:text-white">{item.tomador.nome}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Documento</span>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {item.tomador.cpfCnpj
                                ? `${item.tomador.docTipo === 'cnpj' ? 'CNPJ' : item.tomador.docTipo === 'passaporte' ? 'Pass.' : 'CPF'}: ${item.tomador.cpfCnpj}`
                                : 'Nao informado'}
                            </p>
                          </div>
                          {item.tomador.email && (
                            <div>
                              <span className="text-gray-500 text-xs">E-mail</span>
                              <p className="font-medium text-gray-900 dark:text-white">{item.tomador.email}</p>
                            </div>
                          )}
                          {item.tomador.endereco && (
                            <div className="col-span-2">
                              <span className="text-gray-500 text-xs">Endereco (WCI)</span>
                              <p className="font-medium text-gray-900 dark:text-white text-xs">{item.tomador.endereco}</p>
                            </div>
                          )}
                        </div>

                        {/* Payment fix for NFC-e */}
                        {tipo === 'nfce' && !item.resolvedTPag && (
                          <div>
                            <label className="block text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">
                              Forma de pagamento (obrigatoria)
                            </label>
                            <select
                              value=""
                              onChange={e => updateItem(idx, { resolvedTPag: e.target.value, resolvedTPagSource: 'Manual' })}
                              className="text-sm border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 w-full"
                            >
                              <option value="">Selecione...</option>
                              {TPAG_OPTIONS.map(([code, lbl]) => <option key={code} value={code}>{lbl}</option>)}
                            </select>
                          </div>
                        )}

                        {/* Override payment for NFC-e (already resolved) */}
                        {tipo === 'nfce' && item.resolvedTPag && (
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              Pagamento {item.resolvedTPagSource ? `(detectado: ${item.resolvedTPagSource})` : ''}
                            </label>
                            <select
                              value={item.resolvedTPag}
                              onChange={e => updateItem(idx, { resolvedTPag: e.target.value, resolvedTPagSource: 'Manual' })}
                              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 w-full"
                            >
                              {TPAG_OPTIONS.map(([code, lbl]) => <option key={code} value={code}>{lbl}</option>)}
                            </select>
                          </div>
                        )}

                        {/* Document fix for NFS-e */}
                        {tipo === 'nfse' && !item.tomador.cpfCnpj && (
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <label className="block text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">CPF/CNPJ (obrigatorio)</label>
                              <input
                                type="text"
                                placeholder="Informe o CPF ou CNPJ"
                                className="w-full text-sm border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800"
                                onBlur={e => {
                                  const val = e.target.value.replace(/\D/g, '');
                                  if (val) {
                                    const docTipo = val.length === 14 ? 'cnpj' as const : 'cpf' as const;
                                    updateItem(idx, {
                                      tomador: { ...item.tomador, cpfCnpj: val, docTipo },
                                    });
                                  }
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <button onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-sm font-medium">
                Cancelar
              </button>
              <div className="flex-1 text-xs text-gray-500 text-center">
                Emitido por: {userName}
              </div>
              <button
                onClick={() => enriched && onConfirm(enriched)}
                disabled={readyCount === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
              >
                Emitir {readyCount} {tipoLabel}(s)
              </button>
            </div>

            <p className="px-6 pb-3 text-xs text-gray-400 text-center">
              Todos os lancamentos elegiveis serao incluidos. Para selecionar itens individualmente, emita reserva por reserva.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
