// src/components/nf/BookingNFSection.tsx
// Extrato ÚNICO da conta corrente de uma reserva Erbon com emissão de NF.
// Componente compartilhado por TODOS os modais (planning, rack, check-in,
// check-out, in-house): uma lista só, sem duplicar informação.
//  - clicar no lançamento seleciona/desseleciona para a emissão (sem checkbox)
//  - lançamentos já faturados em produção mostram o selo de NF (clique reabre)
//  - notas emitidas da reserva visíveis com reimpressão, de qualquer tela
//  - botões NFS-e (serviços) e NFC-e (consumidor) seguem as permissões
import React, { useState, useEffect, useCallback } from 'react';
import {
  Receipt, ShoppingBag, FileCheck2, Loader2, CheckCircle2,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { nfService } from '../../lib/nfService';
import { NFInvoiceModal, isServiceEntry, type CurrentAccountEntry } from './NFInvoiceModal';
import type { NFInvoice, NFTipo } from '../../types/nf';
import { usePermissions } from '../../hooks/usePermissions';

export interface AccountEntryLike {
  id: any;
  description: string;
  amount: number;
  isDebit: boolean;
  isCredit: boolean;
  quantity?: number;
  date?: string;
  department?: string;
  source?: string;
  paymentType?: string;
  titleNumber?: string;
}

interface BookingNFSectionProps {
  hotelId: string;
  bookingInternalId: number;
  bookingNumber: string | number | null;
  roomDescription?: string | null;
  /** Lista de hóspedes no formato Erbon (guestList) para prefill do tomador */
  guestList?: any[];
  /** Lançamentos da conta corrente */
  entries: AccountEntryLike[];
  /** Chamado após emissão bem sucedida (para recarregar a conta na tela pai) */
  onEmitted?: () => void;
  /** Exibe também a lista de créditos/pagamentos (default true) */
  showCredits?: boolean;
}

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDay = (d?: string) => {
  if (!d) return null;
  try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return null; }
};

export const BookingNFSection: React.FC<BookingNFSectionProps> = ({
  hotelId, bookingInternalId, bookingNumber, roomDescription, guestList, entries, onEmitted,
  showCredits = true,
}) => {
  const { can } = usePermissions();
  const [emittedEntries, setEmittedEntries] = useState<Map<number, string>>(new Map());
  const [bookingInvoices, setBookingInvoices] = useState<NFInvoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [nfModalType, setNfModalType] = useState<NFTipo | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [viewInvoiceTipo, setViewInvoiceTipo] = useState<NFTipo>('nfse');
  const [loading, setLoading] = useState(true);

  const canEmitAny = can('nf.emit.nfse') || can('nf.emit.nfce');

  const loadNFData = useCallback(async () => {
    setLoading(true);
    try {
      const [map, invs] = await Promise.all([
        nfService.getEmittedEntries(hotelId).catch(() => new Map<number, string>()),
        nfService.getInvoicesByBooking(
          hotelId,
          bookingInternalId ?? null,
          bookingNumber != null ? String(bookingNumber) : null,
        ).catch(() => [] as NFInvoice[]),
      ]);
      setEmittedEntries(map);
      setBookingInvoices(invs);
    } finally {
      setLoading(false);
    }
  }, [hotelId, bookingInternalId, bookingNumber]);

  useEffect(() => { loadNFData(); }, [loadNFData]);

  const debits = entries.filter(e => e.isDebit);
  const credits = entries.filter(e => e.isCredit);
  const totalDebit = debits.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalCredit = credits.reduce((s, e) => s + Number(e.amount || 0), 0);

  const entryIdOf = (e: AccountEntryLike) => (typeof e.id === 'number' ? e.id : Number(e.id));

  const toggle = (e: AccountEntryLike) => {
    const id = entryIdOf(e);
    if (!Number.isFinite(id) || emittedEntries.has(id)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedEntries: CurrentAccountEntry[] = debits
    .filter(e => selectedIds.has(entryIdOf(e)))
    .map(e => ({
      id: entryIdOf(e),
      description: e.description,
      amount: e.amount,
      isDebit: true,
      isCredit: false,
      currency: 'BRL',
      isInvoiced: false,
      idDepartment: 0,
    }));

  const selectedTotal = selectedEntries.reduce((s, e) => s + e.amount, 0);

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-sky-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Notas já emitidas desta reserva (qualquer tela de origem) */}
      {bookingInvoices.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <FileCheck2 className="w-3.5 h-3.5" /> Notas fiscais desta reserva
          </p>
          {bookingInvoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">
                  {inv.tipo === 'nfse' ? 'NFS-e' : inv.tipo === 'nfce' ? 'NFC-e' : 'NF-e'}
                  {inv.numero_nf ? ` · Nº ${inv.numero_nf}` : ''}{inv.serie ? `/${inv.serie}` : ''}
                  {inv.status === 'contingencia' ? ' · contingência' : ''}
                </span>
                <span className="block text-[11px] text-gray-400 truncate">
                  {inv.created_at ? new Date(inv.created_at).toLocaleString('pt-BR') : ''}
                  {inv.valor_total != null ? ` · R$ ${Number(inv.valor_total).toFixed(2)}` : ''}
                </span>
              </div>
              <button
                onClick={() => { setViewInvoiceId(inv.id); setViewInvoiceTipo(inv.tipo); }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-colors"
                title="Revisualizar e reimprimir esta nota">
                <FileCheck2 className="w-3.5 h-3.5" /> Reimprimir
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Débitos (consumos) — clicar no item seleciona para a emissão de NF */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-red-500 uppercase tracking-wider">
            <ArrowDownCircle className="w-3.5 h-3.5" /> Débitos · Consumos ({debits.length})
          </p>
          {canEmitAny && debits.length > 0 && (
            <p className="text-[10px] text-gray-400">Clique no lançamento para selecionar</p>
          )}
        </div>
        {debits.length === 0 ? (
          <p className="text-xs text-gray-400">Sem consumos.</p>
        ) : (
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 max-h-72 overflow-y-auto">
            {debits.map((e, i) => {
              const entryId = entryIdOf(e);
              const emittedInvId = Number.isFinite(entryId) ? emittedEntries.get(entryId) : undefined;
              const selectable = canEmitAny && Number.isFinite(entryId) && !emittedInvId;
              const isSelected = selectedIds.has(entryId);
              const meta = [
                fmtDay(e.date),
                e.department,
                e.quantity && e.quantity > 1 ? `${e.quantity}x` : null,
                e.source,
              ].filter(Boolean).join(' · ');
              return (
                <div
                  key={e.id ?? i}
                  onClick={() => selectable && toggle(e)}
                  className={`flex items-center justify-between px-3 py-2 text-sm gap-3 transition-colors ${
                    selectable ? 'cursor-pointer hover:bg-sky-50 dark:hover:bg-sky-900/10' : ''
                  } ${isSelected ? 'bg-sky-50 dark:bg-sky-900/20 ring-1 ring-inset ring-sky-300 dark:ring-sky-700' : ''}`}
                >
                  <div className="shrink-0 w-5 flex justify-center">
                    {emittedInvId ? (
                      <button
                        onClick={ev => {
                          ev.stopPropagation();
                          setViewInvoiceId(emittedInvId);
                          setViewInvoiceTipo(isServiceEntry(e) ? 'nfse' : 'nfce');
                        }}
                        title="NF já emitida · clique para visualizar/reimprimir"
                        className="text-green-600 dark:text-green-400 hover:scale-110 transition-transform">
                        <FileCheck2 className="w-4 h-4" />
                      </button>
                    ) : isSelected ? (
                      <CheckCircle2 className="w-4 h-4 text-sky-500" />
                    ) : (
                      <span className={`inline-block w-3.5 h-3.5 rounded-full border ${selectable ? 'border-gray-300 dark:border-gray-600' : 'border-transparent'}`} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                    {meta && <p className="text-[11px] text-gray-400 truncate">{meta}</p>}
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

      {/* Barra de emissão */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-sky-50 dark:bg-sky-900/15 border border-sky-100 dark:border-sky-900/40">
          <span className="text-xs font-semibold text-sky-700 dark:text-sky-300 mr-auto">
            {selectedIds.size} selecionado(s) · {fmtBRL(selectedTotal)}
          </span>
          {can('nf.emit.nfse') && (
            <button onClick={() => setNfModalType('nfse')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-colors">
              <Receipt className="w-3.5 h-3.5" /> Emitir NFS-e (Serviços)
            </button>
          )}
          {can('nf.emit.nfce') && (
            <button onClick={() => setNfModalType('nfce')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-colors">
              <ShoppingBag className="w-3.5 h-3.5" /> Emitir NFC-e (Consumidor)
            </button>
          )}
        </div>
      )}

      {/* Créditos (pagamentos) */}
      {showCredits && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">
            <ArrowUpCircle className="w-3.5 h-3.5" /> Créditos · Pagamentos ({credits.length})
          </p>
          {credits.length === 0 ? (
            <p className="text-xs text-gray-400">Sem pagamentos registrados.</p>
          ) : (
            <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
              {credits.map((e, i) => {
                const meta = [e.paymentType, e.titleNumber, fmtDay(e.date)].filter(Boolean).join(' · ');
                return (
                  <div key={e.id ?? i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                    <div className="min-w-0">
                      <p className="text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                      {meta && <p className="text-[11px] text-gray-400 truncate">{meta}</p>}
                    </div>
                    <span className="font-semibold text-emerald-600 whitespace-nowrap">{fmtBRL(e.amount)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between px-3 py-2 text-sm bg-emerald-50/60 dark:bg-emerald-900/10">
                <span className="font-bold text-gray-500 text-xs uppercase">Total</span>
                <span className="font-black text-emerald-600">{fmtBRL(totalCredit)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de emissão/reimpressão */}
      {(nfModalType !== null || viewInvoiceId !== null) && (
        <div onClick={e => e.stopPropagation()}>
          <NFInvoiceModal
            isOpen
            onClose={() => { setNfModalType(null); setViewInvoiceId(null); }}
            tipo={viewInvoiceId ? viewInvoiceTipo : (nfModalType || 'nfse')}
            hotelId={hotelId}
            booking={{
              bookingInternalID: bookingInternalId,
              erbonNumber: bookingNumber,
              roomDescription: roomDescription || null,
              guestList: guestList || [],
            }}
            selectedEntries={viewInvoiceId ? [] : selectedEntries}
            onSuccess={() => {
              setSelectedIds(new Set());
              loadNFData();
              onEmitted?.();
            }}
            viewInvoiceId={viewInvoiceId}
          />
        </div>
      )}
    </div>
  );
};

export default BookingNFSection;
