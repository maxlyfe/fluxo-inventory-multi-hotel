// src/components/nf/BookingExtratoSection.tsx
// Aba "Extratos" da reserva Erbon: mostra os lançamentos da conta corrente
// que já estão FATURADOS na Erbon (isInvoiced), separados automaticamente em:
//  - PRODUTOS → emissão de NFC-e (inclui serviços reclassificados como
//    acréscimo via catálogo nfce_eligible, ex.: taxa de serviço 10%)
//  - SERVIÇOS → emissão de NFS-e (diárias, taxas de turismo etc.)
// Os botões de emissão são GLOBAIS: emitem todos os itens pendentes do grupo
// de uma vez. Itens já emitidos aparecem com selo e ficam de fora.
// Componente compartilhado — usado pelo BookingDetailModal (todas as telas).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Receipt, ShoppingBag, FileCheck2, Loader2, RefreshCw, Clock,
} from 'lucide-react';
import { erbonService } from '../../lib/erbonService';
import { nfService, matchesEligibleService, type NfceEligibleService, type ErbonMappingRow } from '../../lib/nfService';
import { NFInvoiceModal, type CurrentAccountEntry } from './NFInvoiceModal';
import type { NFTipo } from '../../types/nf';
import { usePermissions } from '../../hooks/usePermissions';

interface BookingExtratoSectionProps {
  hotelId: string;
  bookingInternalId: number;
  bookingNumber: string | number | null;
  roomDescription?: string | null;
  /** Lista de hóspedes no formato Erbon (guestList) para prefill do tomador */
  guestList?: any[];
  /** Chamado após emissão bem sucedida */
  onEmitted?: () => void;
}

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const BookingExtratoSection: React.FC<BookingExtratoSectionProps> = ({
  hotelId, bookingInternalId, bookingNumber, roomDescription, guestList, onEmitted,
}) => {
  const { can } = usePermissions();
  const [account, setAccount] = useState<CurrentAccountEntry[] | null>(null);
  const [emittedEntries, setEmittedEntries] = useState<Map<number, string>>(new Map());
  const [eligible, setEligible] = useState<NfceEligibleService[]>([]);
  const [erbonMappings, setErbonMappings] = useState<ErbonMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nfModalType, setNfModalType] = useState<NFTipo | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [viewInvoiceTipo, setViewInvoiceTipo] = useState<NFTipo>('nfse');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, emitted, elig, mappings] = await Promise.all([
        erbonService.fetchBookingAccount(hotelId, bookingInternalId),
        nfService.getEmittedEntries(hotelId).catch(() => new Map<number, string>()),
        nfService.getNfceEligibleServices(hotelId).catch(() => [] as NfceEligibleService[]),
        nfService.getErbonMappingIndex(hotelId).catch(() => [] as ErbonMappingRow[]),
      ]);
      setAccount((acc || []).filter((e: any) => e.isDebit) as CurrentAccountEntry[]);
      setEmittedEntries(emitted);
      setEligible(elig);
      setErbonMappings(mappings);
    } catch {
      setAccount([]);
    } finally {
      setLoading(false);
    }
  }, [hotelId, bookingInternalId]);

  useEffect(() => { load(); }, [load]);

  // Classificação: serviço reclassificado como acréscimo (nfce_eligible no
  // catálogo, ex.: taxa de serviço 10%) conta como PRODUTO na NFC-e (vOutro).
  const isAcrescimo = useCallback(
    (e: { description: string }) => eligible.some(s => matchesEligibleService(e.description, s)),
    [eligible],
  );
  const isProductEntry = useCallback(
    (e: { description: string; idDepartment?: number }) =>
      !nfService.isServiceEntryMapped(e, erbonMappings) || isAcrescimo(e),
    [isAcrescimo, erbonMappings],
  );

  const groups = useMemo(() => {
    const invoiced = (account || []).filter(e => e.isInvoiced);
    const pending = (account || []).filter(e => !e.isInvoiced);
    const products = invoiced.filter(isProductEntry);
    const services = invoiced.filter(e => !isProductEntry(e));
    const notEmitted = (list: CurrentAccountEntry[]) => list.filter(e => !emittedEntries.has(e.id));
    return {
      products, services, pending,
      productsToEmit: notEmitted(products),
      servicesToEmit: notEmitted(services),
    };
  }, [account, emittedEntries, isProductEntry]);

  const selectedEntries: CurrentAccountEntry[] =
    nfModalType === 'nfce' ? groups.productsToEmit
    : nfModalType === 'nfse' ? groups.servicesToEmit
    : [];

  if (loading || account === null) {
    return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>;
  }

  const renderGroup = (
    title: string,
    icon: React.ReactNode,
    accent: string,
    items: CurrentAccountEntry[],
    toEmit: CurrentAccountEntry[],
    emitTipo: NFTipo,
    emitLabel: string,
    canEmit: boolean,
    btnClass: string,
  ) => {
    const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalToEmit = toEmit.reduce((s, e) => s + Number(e.amount || 0), 0);
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${accent}`}>
            {icon} {title} ({items.length})
          </p>
          {canEmit && toEmit.length > 0 && (
            <button onClick={() => setNfModalType(emitTipo)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-white rounded-lg text-xs font-bold transition-colors ${btnClass}`}>
              {icon} {emitLabel} · {fmtBRL(totalToEmit)}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhum item faturado neste grupo.</p>
        ) : (
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 max-h-60 overflow-y-auto">
            {items.map((e, i) => {
              const emittedInvId = emittedEntries.get(e.id);
              const acr = emitTipo === 'nfce' && nfService.isServiceEntryMapped(e, erbonMappings) && isAcrescimo(e);
              return (
                <div key={e.id ?? i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                  <div className="shrink-0 w-5 flex justify-center">
                    {emittedInvId ? (
                      <button
                        onClick={() => { setViewInvoiceId(emittedInvId); setViewInvoiceTipo(emitTipo); }}
                        title="NF já emitida · clique para visualizar/reimprimir"
                        className="text-green-600 dark:text-green-400 hover:scale-110 transition-transform">
                        <FileCheck2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="inline-block w-3.5 h-3.5 rounded-full border border-gray-200 dark:border-gray-700" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-700 dark:text-gray-200 truncate">{e.description}</p>
                    {acr && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        Serviço reclassificado · entra na NFC-e como acréscimo
                      </p>
                    )}
                  </div>
                  <span className="font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtBRL(e.amount)}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-3 py-2 text-sm bg-gray-50/60 dark:bg-gray-800/40">
              <span className="font-bold text-gray-500 text-xs uppercase">Total faturado</span>
              <span className="font-black text-gray-700 dark:text-gray-200">{fmtBRL(total)}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          Itens com status <span className="font-bold">FATURADO</span> na Erbon, separados para emissão.
        </p>
        <button onClick={load} title="Recarregar extrato"
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {renderGroup(
        'Serviços · NFS-e', <Receipt className="w-3.5 h-3.5" />, 'text-sky-600 dark:text-sky-400',
        groups.services, groups.servicesToEmit, 'nfse', 'Emitir NFS-e',
        can('nf.emit.nfse'), 'bg-sky-600 hover:bg-sky-700',
      )}

      {renderGroup(
        'Produtos · NFC-e', <ShoppingBag className="w-3.5 h-3.5" />, 'text-violet-600 dark:text-violet-400',
        groups.products, groups.productsToEmit, 'nfce', 'Emitir NFC-e',
        can('nf.emit.nfce'), 'bg-violet-600 hover:bg-violet-700',
      )}

      {/* Itens ainda não faturados na Erbon — só informativo */}
      {groups.pending.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
            <Clock className="w-3.5 h-3.5" /> Aguardando faturamento na Erbon ({groups.pending.length})
          </p>
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-800">
            {groups.pending.map((e, i) => (
              <div key={e.id ?? i} className="flex items-center justify-between px-3 py-2 text-sm gap-3 opacity-60">
                <p className="text-gray-500 dark:text-gray-400 truncate flex-1">{e.description}</p>
                <span className="font-semibold text-gray-400 whitespace-nowrap">{fmtBRL(e.amount)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            Estes itens só entram na emissão depois de faturados na Erbon.
          </p>
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
              setNfModalType(null);
              load();
              onEmitted?.();
            }}
            viewInvoiceId={viewInvoiceId}
          />
        </div>
      )}
    </div>
  );
};

export default BookingExtratoSection;
