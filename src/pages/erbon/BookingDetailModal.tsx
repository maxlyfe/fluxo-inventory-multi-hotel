// src/pages/erbon/BookingDetailModal.tsx
// Modal detalhado da reserva Erbon (aberto pelo Planning):
//  - Resumo: datas, UH, pax, tarifa, segmento/origem
//  - Hóspedes: lista detalhada, remover, vincular hóspede existente da Erbon,
//    adicionar via web-checkin (QR/link abrindo a reserva específica)
//  - Conta Corrente: débitos x créditos, consumos e pagamentos detalhados

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Loader2, Users, CalendarRange, BedDouble, Wallet, UserPlus, Trash2,
  QrCode, Link2, Search, RefreshCw, CheckCircle2, ArrowDownCircle, ArrowUpCircle,
  Receipt as ReceiptIcon, ShoppingBag, FileCheck2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { erbonService, ErbonBooking, ErbonGuest } from '../../lib/erbonService';
import { createWCISession, WebCheckinGuest } from '../webcheckin/webCheckinService';
import { ensureHotelWciCode } from '../../lib/wciCode';
import { useNotification } from '../../context/NotificationContext';
import { nfService } from '../../lib/nfService';
import { NFInvoiceModal, isServiceEntry, type CurrentAccountEntry } from '../../components/nf/NFInvoiceModal';

interface BookingDetailModalProps {
  hotelId: string;
  booking: ErbonBooking;
  onClose: () => void;
}

type Tab = 'resumo' | 'hospedes' | 'conta';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function headerColor(b: ErbonBooking): string {
  const s = `${b.status || ''} ${b.confirmedStatus || ''}`.toUpperCase();
  const now = new Date();
  try {
    const ci = parseISO(b.checkInDateTime); const co = parseISO(b.checkOutDateTime);
    if (s.includes('CHECKOUT') || co < now) return 'linear-gradient(135deg, #94a3b8, #64748b)';
    if (s.includes('CHECKIN') || s.includes('HOUSE') || (ci <= now && co >= now)) return 'linear-gradient(135deg, #34d399, #059669)';
  } catch { /* noop */ }
  if (s.includes('PEND') || s.includes('WAIT')) return 'linear-gradient(135deg, #fbbf24, #d97706)';
  return 'linear-gradient(135deg, #818cf8, #4f46e5)';
}

const BookingDetailModal: React.FC<BookingDetailModalProps> = ({ hotelId, booking: initialBooking, onClose }) => {
  const { addNotification } = useNotification();
  const [tab, setTab] = useState<Tab>('resumo');
  const [booking, setBooking] = useState<ErbonBooking>(initialBooking);
  const [refreshing, setRefreshing] = useState(false);

  // Conta corrente — lançamento normalizado e enriquecido
  interface AccountEntry {
    id: any;
    description: string;
    amount: number;
    isDebit: boolean;
    isCredit: boolean;
    quantity?: number;
    date?: string;        // dia do lançamento (via sales/transactions)
    department?: string;  // departamento (via sales/transactions)
    source?: string;      // POS, PMS... (via sales/transactions)
    paymentType?: string; // forma de pagamento (créditos, via recibo)
    titleNumber?: string; // nº do recibo (créditos)
  }
  const [account, setAccount] = useState<AccountEntry[] | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);

  // Emissão de NF a partir da conta corrente
  const [emittedEntries, setEmittedEntries] = useState<Map<number, string>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [nfModalType, setNfModalType] = useState<'nfse' | 'nfe' | 'nfce' | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [viewInvoiceTipo, setViewInvoiceTipo] = useState<'nfse' | 'nfe' | 'nfce'>('nfse');

  const loadEmittedEntries = useCallback(async () => {
    try {
      const map = await nfService.getEmittedEntries(hotelId);
      setEmittedEntries(map);
    } catch { /* badge de NF é best-effort */ }
  }, [hotelId]);

  useEffect(() => {
    if (tab === 'conta') loadEmittedEntries();
  }, [tab, loadEmittedEntries]);

  // Hóspedes — ações
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [inHouse, setInHouse] = useState<ErbonGuest[] | null>(null);
  const [attachSearch, setAttachSearch] = useState('');
  const [attachingId, setAttachingId] = useState<number | null>(null);

  // Web-checkin QR
  const [wciUrl, setWciUrl] = useState<string | null>(null);
  const [generatingWci, setGeneratingWci] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const guests = booking.guestList || [];
  const nights = useMemo(() => {
    try {
      return differenceInCalendarDays(parseISO(booking.checkOutDateTime), parseISO(booking.checkInDateTime));
    } catch { return 0; }
  }, [booking]);

  // ── Recarrega a reserva (hóspedes frescos) ─────────────────────────────────
  const refreshBooking = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await erbonService.fetchBookingByInternalId(hotelId, booking.bookingInternalID);
      if (fresh) setBooking(fresh);
    } catch { /* mantém dados atuais */ }
    finally { setRefreshing(false); }
  }, [hotelId, booking.bookingInternalID]);

  useEffect(() => { refreshBooking(); }, []);

  // ── Conta corrente (lazy — ao abrir a aba) ─────────────────────────────────
  // A API da Erbon divide a informação em DUAS fontes:
  //  - /booking/{id}/currentaccount → só traz os DÉBITOS (consumos/diárias)
  //  - /sales/financialaccountreceive → recibos com a conta completa,
  //    incluindo CRÉDITOS/adiantamentos e a forma de pagamento
  // Mesclamos as duas (dedupe por id do lançamento) para não faltar nada.
  useEffect(() => {
    if (tab !== 'conta' || account !== null || loadingAccount) return;
    setLoadingAccount(true);
    (async () => {
      const [accR, arR] = await Promise.allSettled([
        erbonService.fetchBookingAccount(hotelId, booking.bookingInternalID),
        erbonService.fetchAccountsReceivable(hotelId),
      ]);

      const map = new Map<any, AccountEntry>();
      if (accR.status === 'fulfilled') {
        for (const e of (accR.value || [])) {
          map.set(e.id ?? `live-${map.size}`, {
            id: e.id, description: e.description, amount: e.amount,
            isDebit: !!e.isDebit, isCredit: !!e.isCredit,
          });
        }
      }

      // Recibos do contas a receber: completam CRÉDITOS que o currentaccount
      // omite e trazem a forma de pagamento. ATENÇÃO: valueTotal do recibo é
      // o total do TÍTULO (pode agrupar outras contas) — o que pertence a
      // esta reserva são os lançamentos da currentAccountList.
      if (arR.status === 'fulfilled') {
        for (const r of ((arR.value as any[]) || [])) {
          if (String(r.bookingNumber) !== String(booking.erbonNumber)) continue;
          if (r.isCanceled) continue;
          for (const it of (r.currentAccountList || [])) {
            if (it.iscanceled) continue;
            const existing = map.get(it.id);
            const receiptInfo = it.iscredit
              ? { paymentType: r.paymentType, titleNumber: r.titleNumber, date: r.emissionDate }
              : {};
            if (existing) {
              Object.assign(existing, receiptInfo, { quantity: existing.quantity ?? it.quantity });
            } else {
              map.set(it.id, {
                id: it.id, description: it.description, amount: it.valueTotal,
                isDebit: !!it.isdebit, isCredit: !!it.iscredit,
                quantity: it.quantity || undefined,
                ...receiptInfo,
              });
            }
          }
        }
      }

      setAccount([...map.values()]);
      setLoadingAccount(false);

      // ── Enriquecimento assíncrono: data/departamento/origem dos consumos ──
      // sales/transactions é por dia; varre a estadia (máx. 31 dias) e casa
      // cada transação com o lançamento pela descrição + valor.
      try {
        const ci = parseISO(booking.checkInDateTime);
        const co = parseISO(booking.checkOutDateTime);
        const today = new Date();
        const end = co < today ? co : today;
        const totalDays = Math.min(differenceInCalendarDays(end, ci) + 1, 31);
        if (totalDays <= 0) return;
        const dates = Array.from({ length: totalDays }, (_, i) =>
          format(new Date(ci.getTime() + i * 86400000), 'yyyy-MM-dd'));

        const txAll: any[] = [];
        const CHUNK = 8;
        for (let i = 0; i < dates.length; i += CHUNK) {
          const settled = await Promise.allSettled(
            dates.slice(i, i + CHUNK).map(d => erbonService.fetchTransactionsForDate(hotelId, d)),
          );
          for (const s of settled) if (s.status === 'fulfilled') txAll.push(...(s.value as any[]));
        }
        if (txAll.length === 0) return;

        setAccount(prev => {
          if (!prev) return prev;
          const pool = txAll.filter((t: any) => !t.isCanceled);
          const used = new Set<number>();
          return prev.map(entry => {
            if (!entry.isDebit || entry.date) return entry;
            const idx = pool.findIndex((t: any, ti: number) =>
              !used.has(ti)
              && (t.serviceDescription || '').trim().toLowerCase() === (entry.description || '').trim().toLowerCase()
              && Math.abs((t.valueTotal ?? 0) - (entry.amount ?? 0)) < 0.01,
            );
            if (idx === -1) return entry;
            used.add(idx);
            const t = pool[idx];
            return {
              ...entry,
              date: t.date,
              department: t.department,
              quantity: entry.quantity ?? t.quantity,
              source: t.idSource || undefined,
            };
          });
        });
      } catch { /* enriquecimento é best-effort */ }
    })();
  }, [tab]);

  const debits  = useMemo(() => (account || []).filter((e: any) => e.isDebit), [account]);
  const credits = useMemo(() => (account || []).filter((e: any) => e.isCredit), [account]);
  const totalDebit  = debits.reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const totalCredit = credits.reduce((s: number, e: any) => s + (e.amount || 0), 0);
  const balance = totalCredit - totalDebit;

  // ── Remover hóspede ────────────────────────────────────────────────────────
  const handleRemoveGuest = async (guestId: number, name: string) => {
    if (!confirm(`Remover "${name}" desta reserva?`)) return;
    setRemovingId(guestId);
    try {
      await erbonService.removeGuestFromBooking(hotelId, booking.bookingInternalID, guestId);
      addNotification(`Hóspede "${name}" removido da reserva.`, 'success');
      await refreshBooking();
    } catch (e: any) {
      addNotification('Erro ao remover hóspede: ' + (e.message || ''), 'error');
    } finally {
      setRemovingId(null);
    }
  };

  // ── Vincular hóspede existente da Erbon ────────────────────────────────────
  const openAttach = async () => {
    setShowAttach(true);
    if (inHouse === null) {
      try {
        const list = await erbonService.fetchInHouseGuests(hotelId);
        setInHouse(list || []);
      } catch { setInHouse([]); }
    }
  };

  const handleAttach = async (guestId: number, name: string) => {
    setAttachingId(guestId);
    try {
      await erbonService.attachGuestToBooking(hotelId, booking.bookingInternalID, guestId);
      addNotification(`"${name}" vinculado à reserva.`, 'success');
      setShowAttach(false);
      await refreshBooking();
    } catch (e: any) {
      addNotification('Erro ao vincular: ' + (e.message || ''), 'error');
    } finally {
      setAttachingId(null);
    }
  };

  const filteredInHouse = useMemo(() => {
    if (!inHouse) return [];
    const alreadyIds = new Set(guests.map(g => g.id));
    const term = attachSearch.trim().toLowerCase();
    return inHouse
      .filter(g => !alreadyIds.has(g.idGuest))
      .filter(g => !term || `${g.guestName} ${g.lastName || ''}`.toLowerCase().includes(term))
      .slice(0, 30);
  }, [inHouse, attachSearch, guests]);

  // ── Web-checkin: QR/link abrindo esta reserva ──────────────────────────────
  const handleGenerateWci = async () => {
    setGeneratingWci(true);
    try {
      // Gera o wci_code automaticamente se o hotel ainda não tiver
      const wciCode = await ensureHotelWciCode(hotelId);
      if (!wciCode) {
        addNotification('Não foi possível gerar o código de web-checkin do hotel.', 'error');
        return;
      }
      const wciGuests: WebCheckinGuest[] = guests.map((g, i) => ({
        id: g.id,
        name: g.name,
        email: g.email || undefined,
        phone: g.phone || undefined,
        fnrhCompleted: false,
        isMainGuest: i === 0,
      }));
      const token = await createWCISession(
        booking.bookingInternalID, hotelId, wciGuests,
        String(booking.erbonNumber || booking.bookingInternalID),
      );
      // Mantém o prefixo /grupo/<slug> quando o app roda sob um grupo
      const groupMatch = window.location.pathname.match(/^\/grupo\/([^/]+)/);
      const base = groupMatch ? `${window.location.origin}/grupo/${groupMatch[1]}` : window.location.origin;
      setWciUrl(`${base}/web-checkin/${wciCode}/companion/${token}`);
    } catch (e: any) {
      addNotification('Erro ao gerar link: ' + (e.message || ''), 'error');
    } finally {
      setGeneratingWci(false);
    }
  };

  const copyWciLink = async () => {
    if (!wciUrl) return;
    try {
      await navigator.clipboard.writeText(wciUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch { addNotification('Não foi possível copiar o link.', 'error'); }
  };

  const guestName = guests[0]?.name || `Reserva ${booking.erbonNumber || booking.bookingInternalID}`;

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode) => (
    <button onClick={() => setTab(t)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors border-b-2 ${
        tab === t
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      }`}>
      {icon}{label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
        style={{ maxHeight: '92dvh' }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between shrink-0" style={{ background: headerColor(booking) }}>
          <div className="text-white min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
              Reserva {booking.erbonNumber || booking.bookingInternalID} · {booking.status}
            </p>
            <h3 className="text-base font-bold truncate">{guestName}</h3>
            <p className="text-[11px] opacity-80">
              {format(parseISO(booking.checkInDateTime), 'dd/MM/yyyy', { locale: ptBR })}
              {' → '}
              {format(parseISO(booking.checkOutDateTime), 'dd/MM/yyyy', { locale: ptBR })}
              {' · '}UH {booking.roomDescription}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={refreshBooking}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/80 hover:text-white hover:bg-white/20 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/80 hover:text-white hover:bg-white/20 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 shrink-0">
          {tabBtn('resumo', 'Resumo', <CalendarRange className="w-3.5 h-3.5" />)}
          {tabBtn('hospedes', `Hóspedes (${guests.length})`, <Users className="w-3.5 h-3.5" />)}
          {tabBtn('conta', 'Conta Corrente', <Wallet className="w-3.5 h-3.5" />)}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── RESUMO ── */}
          {tab === 'resumo' && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Check-in" value={format(parseISO(booking.checkInDateTime), "dd/MM/yyyy '·' HH:mm", { locale: ptBR })} />
                <InfoCard label="Check-out" value={format(parseISO(booking.checkOutDateTime), "dd/MM/yyyy '·' HH:mm", { locale: ptBR })} />
                <InfoCard label="UH" value={`${booking.roomDescription} · ${booking.roomTypeDescription}`} />
                <InfoCard label="Diárias" value={String(nights)} />
                <InfoCard label="Pax" value={`${booking.adultQuantity} ad${booking.childQuantity ? ` · ${booking.childQuantity} chd` : ''}${booking.babyQuantity ? ` · ${booking.babyQuantity} bb` : ''}`} />
                <InfoCard label="Tarifa total" value={fmtBRL(booking.totalBookingRateWithTax || booking.totalBookingRate)} />
              </div>
              {(booking.segmentDesc || booking.sourceDesc || booking.rateDesc) && (
                <p className="text-xs text-gray-400">
                  {[booking.segmentDesc, booking.sourceDesc, booking.rateDesc].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )}

          {/* ── HÓSPEDES ── */}
          {tab === 'hospedes' && (
            <div className="space-y-3">
              {/* Ações */}
              <div className="flex gap-2">
                <button onClick={handleGenerateWci} disabled={generatingWci}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                  {generatingWci ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                  Adicionar via Web-checkin
                </button>
                <button onClick={openAttach}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                  <UserPlus className="w-3.5 h-3.5" /> Vincular da Erbon
                </button>
              </div>

              {/* Lista de hóspedes */}
              {guests.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Nenhum hóspede na reserva.</p>
              ) : (
                <div className="space-y-2">
                  {guests.map((g, i) => (
                    <div key={g.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {(g.name || '?').split(' ').slice(0, 2).map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                          {g.name}
                          {i === 0 && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 font-bold uppercase">Titular</span>}
                        </p>
                        {g.email && <p className="text-xs text-gray-400 truncate">{g.email}</p>}
                        {g.phone && <p className="text-xs text-gray-400">{g.phone}</p>}
                        {(g.documents || []).map((d, di) => (
                          <p key={di} className="text-[11px] text-gray-400">{d.documentType}: {d.number}</p>
                        ))}
                      </div>
                      <button onClick={() => handleRemoveGuest(g.id, g.name)} disabled={removingId === g.id}
                        title="Remover hóspede da reserva"
                        className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0">
                        {removingId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CONTA CORRENTE ── */}
          {tab === 'conta' && (
            loadingAccount || account === null ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
            ) : account.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum lançamento na conta corrente.</p>
            ) : (
              <div className="space-y-4">
                {/* Saldo */}
                <div className={`p-3 rounded-xl text-center ${balance >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Saldo</p>
                  <p className={`text-xl font-black ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtBRL(balance)}</p>
                </div>

                {/* Barra de emissão de NF */}
                <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} ${selectedIds.size === 1 ? 'lançamento selecionado' : 'lançamentos selecionados'} para faturamento`
                      : 'Selecione lançamentos abaixo para emitir a nota fiscal'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setNfModalType('nfse')} disabled={selectedIds.size === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-200 dark:disabled:bg-gray-700/50 text-white disabled:text-gray-400 dark:disabled:text-gray-500 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed">
                      <ReceiptIcon className="w-3.5 h-3.5" /> NF Serviços
                    </button>
                    <button onClick={() => setNfModalType('nfe')} disabled={selectedIds.size === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-700/50 text-white disabled:text-gray-400 dark:disabled:text-gray-500 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed">
                      <ShoppingBag className="w-3.5 h-3.5" /> NF Consumo
                    </button>
                    <button onClick={() => setNfModalType('nfce')} disabled={selectedIds.size === 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 dark:disabled:bg-gray-700/50 text-white disabled:text-gray-400 dark:disabled:text-gray-500 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed">
                      <ReceiptIcon className="w-3.5 h-3.5" /> NFC-e
                    </button>
                  </div>
                </div>

                {/* Débitos (consumos) */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-red-500 uppercase tracking-wider mb-2">
                    <ArrowDownCircle className="w-3.5 h-3.5" /> Débitos · Consumos ({debits.length})
                  </p>
                  {debits.length === 0 ? (
                    <p className="text-xs text-gray-400">Sem consumos.</p>
                  ) : (
                    <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
                      {debits.map((e: any, i: number) => {
                        const entryId = typeof e.id === 'number' ? e.id : Number(e.id);
                        const selectable = Number.isFinite(entryId) && !emittedEntries.has(entryId);
                        return (
                        <div key={e.id || i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                          <div className="shrink-0 w-5 flex justify-center">
                            {emittedEntries.has(entryId) ? (
                              <button
                                onClick={() => {
                                  const invId = emittedEntries.get(entryId);
                                  if (invId) {
                                    setViewInvoiceId(invId);
                                    setViewInvoiceTipo(isServiceEntry(e) ? 'nfse' : 'nfe');
                                  }
                                }}
                                title="NF já emitida · clique para visualizar/reimprimir"
                                className="text-green-600 dark:text-green-400 hover:scale-110 transition-transform">
                                <FileCheck2 className="w-4 h-4" />
                              </button>
                            ) : selectable ? (
                              <input type="checkbox" checked={selectedIds.has(entryId)}
                                onChange={() => {
                                  const next = new Set(selectedIds);
                                  if (next.has(entryId)) next.delete(entryId); else next.add(entryId);
                                  setSelectedIds(next);
                                }}
                                className="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer" />
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                            {(e.date || e.department || e.quantity > 1 || e.source) && (
                              <p className="text-[11px] text-gray-400 truncate">
                                {[
                                  e.date ? format(parseISO(e.date), 'dd/MM/yyyy') : null,
                                  e.department,
                                  e.quantity > 1 ? `${e.quantity}x` : null,
                                  e.source,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          <span className="font-semibold text-red-500 whitespace-nowrap">{fmtBRL(e.amount)}</span>
                        </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-3 py-2 text-sm bg-red-50/60 dark:bg-red-900/10">
                        <span className="font-bold text-gray-500 text-xs uppercase">Total</span>
                        <span className="font-black text-red-600">{fmtBRL(totalDebit)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Créditos (pagamentos) */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">
                    <ArrowUpCircle className="w-3.5 h-3.5" /> Créditos · Pagamentos ({credits.length})
                  </p>
                  {credits.length === 0 ? (
                    <p className="text-xs text-gray-400">Sem pagamentos registrados.</p>
                  ) : (
                    <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
                      {credits.map((e: any, i: number) => (
                        <div key={e.id || i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                          <div className="min-w-0">
                            <p className="text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                            {(e.paymentType || e.titleNumber || e.date) && (
                              <p className="text-[11px] text-gray-400 truncate">
                                {[
                                  e.paymentType,
                                  e.titleNumber,
                                  e.date ? format(parseISO(e.date), 'dd/MM/yyyy') : null,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          <span className="font-semibold text-emerald-600 whitespace-nowrap">{fmtBRL(e.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 text-sm bg-emerald-50/60 dark:bg-emerald-900/10">
                        <span className="font-bold text-gray-500 text-xs uppercase">Total</span>
                        <span className="font-black text-emerald-600">{fmtBRL(totalCredit)}</span>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )
          )}
        </div>
      </div>

      {/* ── Modal de emissão/reimpressão de NF ── */}
      <div onClick={e => e.stopPropagation()}>
      <NFInvoiceModal
        isOpen={nfModalType !== null || viewInvoiceId !== null}
        onClose={() => {
          setNfModalType(null);
          setViewInvoiceId(null);
        }}
        tipo={viewInvoiceId ? viewInvoiceTipo : (nfModalType || 'nfse')}
        hotelId={hotelId}
        booking={booking}
        selectedEntries={viewInvoiceId ? [] : (account || [])
          .filter((e) => selectedIds.has(typeof e.id === 'number' ? e.id : Number(e.id)))
          .map((e): CurrentAccountEntry => ({
            id: typeof e.id === 'number' ? e.id : Number(e.id),
            description: e.description,
            amount: e.amount,
            isDebit: e.isDebit,
            isCredit: e.isCredit,
            currency: 'BRL',
            isInvoiced: false,
            idDepartment: 0,
          }))}
        onSuccess={() => {
          setSelectedIds(new Set());
          loadEmittedEntries();
        }}
        viewInvoiceId={viewInvoiceId}
      />
      </div>

      {/* ── Sub-modal: QR do web-checkin ── */}
      {wciUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={e => { e.stopPropagation(); setWciUrl(null); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full max-w-xs bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 text-center">
            <QrCode className="w-7 h-7 text-indigo-500 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">Web-checkin da reserva</h4>
            <p className="text-xs text-gray-400 mb-4">
              Escaneie com o celular ou copie o link — o formulário abre direto nesta reserva para incluir o hóspede.
            </p>
            <div className="bg-white p-3 rounded-2xl inline-block border border-gray-100">
              <QRCodeSVG value={wciUrl} size={180} level="M" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={copyWciLink}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                  linkCopied ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}>
                {linkCopied ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copiado!</> : <><Link2 className="w-3.5 h-3.5" /> Copiar link</>}
              </button>
              <button onClick={() => setWciUrl(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: vincular hóspede existente ── */}
      {showAttach && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { e.stopPropagation(); setShowAttach(false); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-sm bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
            style={{ maxHeight: '75dvh' }}>
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
              <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-2">Vincular hóspede da Erbon</h4>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input type="text" value={attachSearch} onChange={e => setAttachSearch(e.target.value)}
                  placeholder="Buscar por nome…" autoFocus
                  className="w-full h-9 pl-8 pr-3 rounded-xl text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/50" />
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">Hóspedes in-house de outras reservas do hotel.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {inHouse === null ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
              ) : filteredInHouse.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">Nenhum hóspede encontrado.</p>
              ) : (
                filteredInHouse.map(g => (
                  <button key={g.idGuest} onClick={() => handleAttach(g.idGuest, `${g.guestName} ${g.lastName || ''}`.trim())}
                    disabled={attachingId !== null}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                        {g.guestName} {g.lastName || ''}
                      </p>
                      <p className="text-[11px] text-gray-400">UH {g.roomDescription} · Reserva {g.bookingNumber}</p>
                    </div>
                    {attachingId === g.idGuest
                      ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
                      : <UserPlus className="w-4 h-4 text-gray-300 shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5 flex items-center gap-1">
      <BedDouble className="w-3 h-3 hidden" />{label}
    </p>
    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{value}</p>
  </div>
);

export default BookingDetailModal;
