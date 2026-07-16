import React, { useState, useEffect } from 'react';
import { X, Search, FileText, Building2, Loader2 } from 'lucide-react';
import { nfService } from '../lib/nfService';
import type { NFReceived } from '../types/nf';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  hotelId: string;
  onSelect: (nf: NFReceived) => void;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function formatDateBR(d: string | null): string {
  if (!d) return '—';
  const iso = d.split('T')[0];
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}`;
}

export default function NFReceivedPickerModal({ isOpen, onClose, hotelId, onSelect }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<NFReceived[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setSearch('');
    nfService.getReceivedNFs(hotelId, { situacao: 'nova' })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [isOpen, hotelId]);

  if (!isOpen) return null;

  const q = search.toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        (r.emitente_nome || '').toLowerCase().includes(q) ||
        (r.emitente_cnpj || '').includes(q.replace(/\D/g, '') || q) ||
        (r.numero_nf || '').includes(q)
      )
    : rows;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-bold text-slate-800 dark:text-white">NF Recebidas Disponíveis</h2>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por fornecedor, CNPJ ou nº NF..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 text-sm px-3 py-2.5 pl-9 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="p-4 max-h-[55vh] overflow-y-auto space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              {rows.length === 0
                ? 'Nenhuma NF recebida disponível para lançamento'
                : 'Nenhuma NF encontrada para a busca'}
            </div>
          ) : (
            filtered.map(nf => (
              <button
                key={nf.id}
                type="button"
                onClick={() => { onSelect(nf); onClose(); }}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left border border-slate-100 dark:border-slate-700/50"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      NF {nf.numero_nf || '—'}
                    </span>
                    {nf.tipo === 'completa' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 font-medium">
                        XML
                      </span>
                    )}
                    {nf.tipo === 'resumo' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300 font-medium">
                        resumo
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {nf.emitente_nome || 'Fornecedor desconhecido'}
                    </span>
                  </div>
                  {nf.emitente_cnpj && (
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5 ml-[18px]">{nf.emitente_cnpj}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {nf.valor_total != null ? fmtBRL(nf.valor_total) : '—'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formatDateBR(nf.data_emissao)}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
