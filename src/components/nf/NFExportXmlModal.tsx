// src/components/nf/NFExportXmlModal.tsx
// Modal de exportação em lote dos XMLs de NF-e recebidas.
// Permite filtrar por período de emissão, selecionar notas individualmente
// ou todas, e baixar os XMLs num único arquivo .zip.

import React, { useMemo, useState } from 'react';
import { X, Download, Loader2, FileArchive, CheckSquare, Square } from 'lucide-react';
import JSZip from 'jszip';
import type { NFReceived } from '../../types/nf';

interface Props {
  rows: NFReceived[];
  onClose: () => void;
}

function fmtDateBR(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function formatCnpj(cnpj: string | null): string {
  const d = (cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj || '—';
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

const NFExportXmlModal: React.FC<Props> = ({ rows, onClose }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só notas com XML disponível podem ser exportadas
  const exportable = useMemo(() => rows.filter(r => !!r.xml), [rows]);

  const filtered = useMemo(() => {
    return exportable.filter(r => {
      const d = (r.data_emissao || '').slice(0, 10);
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo && (!d || d > dateTo)) return false;
      return true;
    });
  }, [exportable, dateFrom, dateTo]);

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const selectedInFilter = filtered.filter(r => selected.has(r.id));

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        filtered.forEach(r => next.delete(r.id));
      } else {
        filtered.forEach(r => next.add(r.id));
      }
      return next;
    });
  }

  async function handleExport() {
    const toExport = selectedInFilter;
    if (toExport.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const zip = new JSZip();
      toExport.forEach(nf => {
        zip.file(`NFe-${nf.chave_acesso}.xml`, nf.xml as string);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NFe-XMLs-${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('[NFExportXml] export:', err);
      setError('Erro ao gerar o arquivo .zip. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileArchive className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-gray-900 dark:text-white">Exportar XMLs em lote</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filtros de data */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Emitidas de</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">até</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
            />
          </div>
          <button
            onClick={toggleAll}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
          >
            {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Nenhuma nota com XML disponível no período selecionado.
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(nf => {
                const isSel = selected.has(nf.id);
                return (
                  <label
                    key={nf.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                      isSel
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(nf.id)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {nf.emitente_nome || 'Emitente não identificado'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {nf.numero_nf ? `NF ${nf.numero_nf}` : ''} · CNPJ {formatCnpj(nf.emitente_cnpj)} · {fmtDateBR(nf.data_emissao)}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white shrink-0 font-mono">
                      {nf.valor_total != null
                        ? `R$ ${nf.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {exportable.length < rows.length && (
            <p className="text-[11px] text-gray-400 mt-3">
              {rows.length - exportable.length} nota(s) sem XML completo não aparecem nesta lista. Envie a Ciência da Operação e sincronize para liberar o XML.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {selectedInFilter.length} de {filtered.length} nota(s) selecionada(s)
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-400 flex-1">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedInFilter.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? 'Gerando .zip…' : `Exportar ${selectedInFilter.length > 0 ? `(${selectedInFilter.length})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NFExportXmlModal;
