import React, { useState, useEffect } from 'react';
import { X, Printer, Download, FileText, Loader2, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabase';
import { nfService } from '../../lib/nfService';
import { printNFA4 } from './NFPrintA4';
import type { NFInvoice, NFHotelConfig } from '../../types/nf';

interface NFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  hotelId: string;
}

interface InvoiceItem {
  id: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  ncm?: string | null;
  cfop?: string | null;
  codigo_servico?: string | null;
  iss_aliquota?: number | null;
  icms_aliquota?: number | null;
}

export default function NFViewerModal({ isOpen, onClose, invoiceId, hotelId }: NFViewerModalProps) {
  const [invoice, setInvoice] = useState<NFInvoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [config, setConfig] = useState<NFHotelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingDanfse, setDownloadingDanfse] = useState(false);

  useEffect(() => {
    if (!isOpen || !invoiceId) return;
    setLoading(true);

    Promise.all([
      supabase.from('nf_invoices').select('*').eq('id', invoiceId).single(),
      supabase.from('nf_invoice_items').select('*').eq('invoice_id', invoiceId),
      nfService.getConfig(hotelId),
    ]).then(([invRes, itemsRes, cfg]) => {
      if (invRes.data) setInvoice(invRes.data);
      if (itemsRes.data) setItems(itemsRes.data);
      setConfig(cfg);
    }).finally(() => setLoading(false));
  }, [isOpen, invoiceId, hotelId]);

  if (!isOpen) return null;

  const tipoLabel = invoice?.tipo === 'nfse' ? 'NFS-e' : invoice?.tipo === 'nfce' ? 'NFC-e' : 'NF-e';
  const statusLabel = invoice?.status === 'autorizada' ? 'AUTORIZADA'
    : invoice?.status === 'cancelada' ? 'CANCELADA'
    : invoice?.status === 'contingencia' ? 'CONTINGÊNCIA'
    : (invoice?.status || '').toUpperCase();

  const statusColor = invoice?.status === 'autorizada' ? 'text-green-600 bg-green-50'
    : invoice?.status === 'cancelada' ? 'text-red-600 bg-red-50'
    : 'text-amber-600 bg-amber-50';

  function handlePrintA4() {
    if (!invoice || !config) return;
    // As linhas de nf_invoice_items já estão no formato esperado pelo printNFA4
    // (descricao/quantidade/valor_unitario/valor_total).
    printNFA4(invoice, items, config);
  }

  function handleDownloadXml() {
    if (!invoice?.xml_retorno) return;
    const blob = new Blob([invoice.xml_retorno], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NF_${invoice.numero_nf || invoice.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadDanfse() {
    if (!invoice) return;
    setDownloadingDanfse(true);
    try {
      const result = await nfService.fetchDANFSE(invoice.id);
      if (result?.pdf_base64) {
        const byteChars = atob(result.pdf_base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DANFSE_${invoice.numero_nf || invoice.id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setDownloadingDanfse(false);
    }
  }

  const formatChave = (chave: string) => chave.replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {tipoLabel} {invoice?.numero_nf ? `nº ${invoice.numero_nf}` : ''}
            </h2>
            {invoice && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>
                {statusLabel}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : invoice ? (
          <div className="px-6 py-4 space-y-5">
            {/* Prestador */}
            <section>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Prestador</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
                <div className="flex items-center gap-3">
                  {config?.logo_url && (
                    <img src={config.logo_url} alt="" className="h-10 w-auto object-contain" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{config?.nome_fantasia || config?.razao_social || '—'}</p>
                    {config?.razao_social && config.nome_fantasia && (
                      <p className="text-gray-500 text-xs">{config.razao_social}</p>
                    )}
                  </div>
                </div>
                <p className="text-gray-600 dark:text-gray-300">CNPJ: {config?.cnpj || '—'}</p>
                {config?.inscricao_municipal && <p className="text-gray-600 dark:text-gray-300">IM: {config.inscricao_municipal}</p>}
                {config?.endereco_logradouro && (
                  <p className="text-gray-500 text-xs">
                    {[config.endereco_logradouro, config.endereco_numero, config.endereco_bairro, config.endereco_cidade, config.endereco_uf].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            </section>

            {/* Tomador */}
            <section>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Tomador / Destinatário</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold text-gray-900 dark:text-white">{invoice.tomador_nome}</p>
                <p className="text-gray-600 dark:text-gray-300">
                  {invoice.tomador_doc_tipo === 'cnpj' ? 'CNPJ' : invoice.tomador_doc_tipo === 'passaporte' ? 'Passaporte' : 'CPF'}: {invoice.tomador_cpf_cnpj || '—'}
                </p>
                {invoice.tomador_email && <p className="text-gray-500 text-xs">{invoice.tomador_email}</p>}
                {invoice.tomador_endereco && <p className="text-gray-500 text-xs">{invoice.tomador_endereco}</p>}
              </div>
            </section>

            {/* Info NF */}
            <section>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Dados da Nota</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Tipo:</span> <span className="font-medium">{tipoLabel}</span></div>
                <div><span className="text-gray-500">Série:</span> <span className="font-medium">{invoice.serie || '1'}</span></div>
                {invoice.numero_nf && <div><span className="text-gray-500">Número:</span> <span className="font-medium">{invoice.numero_nf}</span></div>}
                {invoice.numero_rps && <div><span className="text-gray-500">RPS:</span> <span className="font-medium">{invoice.numero_rps}</span></div>}
                {invoice.numero_protocolo && <div><span className="text-gray-500">Protocolo:</span> <span className="font-medium">{invoice.numero_protocolo}</span></div>}
                {invoice.codigo_verificacao && <div><span className="text-gray-500">Cód. Verificação:</span> <span className="font-medium">{invoice.codigo_verificacao}</span></div>}
                <div><span className="text-gray-500">Emissão:</span> <span className="font-medium">{new Date(invoice.created_at).toLocaleDateString('pt-BR')}</span></div>
                <div><span className="text-gray-500">Reserva:</span> <span className="font-medium">{invoice.booking_number || '—'}</span></div>
                {invoice.nfse_provider === 'adn' && <div className="col-span-2"><span className="text-gray-500">Provedor:</span> <span className="font-medium">ADN (Governo Federal)</span></div>}
              </div>
            </section>

            {/* Itens */}
            <section>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Itens ({items.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 text-xs">
                      <th className="text-left py-1.5 pr-2">Descrição</th>
                      <th className="text-right py-1.5 px-2">Qtd</th>
                      <th className="text-right py-1.5 px-2">Unitário</th>
                      <th className="text-right py-1.5 pl-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1.5 pr-2 text-gray-900 dark:text-white">{item.descricao}</td>
                        <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-300">{item.quantidade}</td>
                        <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-300">{item.valor_unitario.toFixed(2)}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold text-gray-900 dark:text-white">{item.valor_total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Totais */}
            <section>
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Valores</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Valor Total</span><span className="font-bold text-lg text-gray-900 dark:text-white">R$ {Number(invoice.valor_total).toFixed(2)}</span></div>
                {invoice.valor_deducoes > 0 && <div className="flex justify-between"><span className="text-gray-500">Deduções</span><span>R$ {Number(invoice.valor_deducoes).toFixed(2)}</span></div>}
                {invoice.base_calculo > 0 && <div className="flex justify-between"><span className="text-gray-500">Base de Cálculo</span><span>R$ {Number(invoice.base_calculo).toFixed(2)}</span></div>}
                {invoice.aliquota > 0 && <div className="flex justify-between"><span className="text-gray-500">Alíquota</span><span>{(Number(invoice.aliquota) * 100).toFixed(2)}%</span></div>}
                {invoice.valor_iss > 0 && <div className="flex justify-between"><span className="text-gray-500">ISS</span><span>R$ {Number(invoice.valor_iss).toFixed(2)}</span></div>}
              </div>
            </section>

            {/* Chave de Acesso */}
            {invoice.chave_acesso && (
              <section>
                <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Chave de Acesso</h3>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs font-mono break-all text-gray-700 dark:text-gray-300">{formatChave(invoice.chave_acesso)}</p>
                  {invoice.qrcode_url && (
                    <div className="flex items-center gap-4 mt-3">
                      <div className="bg-white p-2 rounded">
                        <QRCodeSVG value={invoice.qrcode_url} size={100} level="M" />
                      </div>
                      {invoice.url_consulta && (
                        <a href={invoice.url_consulta} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Consultar NF
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Cancelamento */}
            {invoice.status === 'cancelada' && (
              <section>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-red-700 dark:text-red-400">Nota Cancelada</p>
                  {invoice.cancelada_em && <p className="text-red-600 dark:text-red-300 text-xs">Em: {new Date(invoice.cancelada_em).toLocaleString('pt-BR')}</p>}
                  {invoice.motivo_cancelamento && <p className="text-red-600 dark:text-red-300 text-xs mt-1">{invoice.motivo_cancelamento}</p>}
                </div>
              </section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button onClick={handlePrintA4} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
                <Printer className="w-4 h-4" /> Imprimir A4
              </button>
              {invoice.xml_retorno && (
                <button onClick={handleDownloadXml} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
                  <Download className="w-4 h-4" /> Download XML
                </button>
              )}
              {invoice.nfse_provider === 'adn' && (
                <button onClick={handleDownloadDanfse} disabled={downloadingDanfse} className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {downloadingDanfse ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} DANFSE (PDF)
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-20 text-gray-500">Nota fiscal não encontrada.</div>
        )}
      </div>
    </div>
  );
}
