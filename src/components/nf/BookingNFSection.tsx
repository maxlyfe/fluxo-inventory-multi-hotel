// src/components/nf/BookingNFSection.tsx
// Seção de emissão de Nota Fiscal para a conta corrente de uma reserva Erbon.
// Usada nos modais da recepção (check-in, check-out, in-house) para que a
// emissão siga as MESMAS regras do planning e da emissão em massa:
//  - notas já emitidas visíveis (com reimpressão), independente da tela de origem
//  - lançamentos já faturados em produção bloqueados (só cancelamento libera)
//  - seleção de lançamentos + botões NFS-e (serviços) e NFC-e (consumidor)
import React, { useState, useEffect, useCallback } from 'react';
import { Receipt, ShoppingBag, FileCheck2, Loader2 } from 'lucide-react';
import { nfService } from '../../lib/nfService';
import { NFInvoiceModal, isServiceEntry, type CurrentAccountEntry } from './NFInvoiceModal';
import type { NFInvoice, NFTipo } from '../../types/nf';
import { usePermissions } from '../../hooks/usePermissions';

interface BookingNFSectionProps {
  hotelId: string;
  bookingInternalId: number;
  bookingNumber: string | number | null;
  roomDescription?: string | null;
  /** Lista de hóspedes no formato Erbon (guestList) para prefill do tomador */
  guestList?: any[];
  /** Lançamentos da conta corrente (id, description, amount, isDebit, isCredit) */
  entries: Array<{ id: any; description: string; amount: number; isDebit: boolean; isCredit: boolean }>;
  /** Chamado após emissão bem sucedida (para recarregar a conta na tela pai) */
  onEmitted?: () => void;
}

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const BookingNFSection: React.FC<BookingNFSectionProps> = ({
  hotelId, bookingInternalId, bookingNumber, roomDescription, guestList, entries, onEmitted,
}) => {
  const { can } = usePermissions();
  const [emittedEntries, setEmittedEntries] = useState<Map<number, string>>(new Map());
  const [bookingInvoices, setBookingInvoices] = useState<NFInvoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [nfModalType, setNfModalType] = useState<NFTipo | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [viewInvoiceTipo, setViewInvoiceTipo] = useState<NFTipo>('nfse');
  const [loading, setLoading] = useState(true);

  const canAny = can('nf.emit.nfse') || can('nf.emit.nfce') || can('nf.emit.nfe');

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

  if (!canAny) return null;

  const debits = entries.filter(e => e.isDebit);
  const selectableDebits = debits.filter(e => {
    const id = typeof e.id === 'number' ? e.id : Number(e.id);
    return Number.isFinite(id) && !emittedEntries.has(id);
  });

  const toggle = (rawId: any) => {
    const id = typeof rawId === 'number' ? rawId : Number(rawId);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedEntries: CurrentAccountEntry[] = debits
    .filter(e => selectedIds.has(typeof e.id === 'number' ? e.id : Number(e.id)))
    .map(e => ({
      id: typeof e.id === 'number' ? e.id : Number(e.id),
      description: e.description,
      amount: e.amount,
      isDebit: true,
      isCredit: false,
      currency: 'BRL',
      isInvoiced: false,
      idDepartment: 0,
    }));

  const selectedTotal = selectedEntries.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4 pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
      <h4 className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300">
        <Receipt className="w-4 h-4 text-sky-500" /> Nota Fiscal
      </h4>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-sky-500" /></div>
      ) : (
        <>
          {/* Notas já emitidas desta reserva (qualquer tela de origem) */}
          {bookingInvoices.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Notas emitidas desta reserva</p>
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

          {/* Seleção de lançamentos para emitir */}
          {debits.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Selecione os lançamentos para emitir NF
              </p>
              <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 max-h-56 overflow-y-auto">
                {debits.map((e, i) => {
                  const entryId = typeof e.id === 'number' ? e.id : Number(e.id);
                  const emittedInvId = Number.isFinite(entryId) ? emittedEntries.get(entryId) : undefined;
                  const selectable = Number.isFinite(entryId) && !emittedInvId;
                  return (
                    <div key={e.id ?? i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                      <div className="shrink-0 w-5 flex justify-center">
                        {emittedInvId ? (
                          <button
                            onClick={() => { setViewInvoiceId(emittedInvId); setViewInvoiceTipo(isServiceEntry(e) ? 'nfse' : 'nfce'); }}
                            title="NF já emitida · clique para visualizar/reimprimir"
                            className="text-green-600 dark:text-green-400 hover:scale-110 transition-transform">
                            <FileCheck2 className="w-4 h-4" />
                          </button>
                        ) : selectable ? (
                          <input type="checkbox" checked={selectedIds.has(entryId)}
                            onChange={() => toggle(e.id)}
                            className="rounded border-gray-300 text-sky-500 focus:ring-sky-500 w-3.5 h-3.5 cursor-pointer" />
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </div>
                      <p className="min-w-0 flex-1 text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                      <span className="font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtBRL(e.amount)}</span>
                    </div>
                  );
                })}
              </div>

              {selectableDebits.length === 0 && (
                <p className="text-[11px] text-gray-400">
                  Todos os lançamentos desta conta já possuem nota fiscal emitida.
                </p>
              )}

              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500 mr-auto">
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
            </div>
          )}
        </>
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
