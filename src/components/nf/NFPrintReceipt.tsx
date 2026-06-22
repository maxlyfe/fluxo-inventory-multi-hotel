import React, { useRef } from 'react';
import { Printer, X } from 'lucide-react';
import type { NFInvoice, NFHotelConfig } from '../../types/nf';

interface NFPrintReceiptProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: NFInvoice;
  items: Array<{
    descricao: string;
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
    ncm?: string | null;
  }>;
  config: NFHotelConfig | null;
}

export const NFPrintReceipt: React.FC<NFPrintReceiptProps> = ({
  isOpen,
  onClose,
  invoice,
  items,
  config,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Cupom Fiscal</title>
        <style>
          @page { margin: 2mm; size: 80mm auto; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 10px; width: 76mm; padding: 2mm; color: #000; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 4px 0; }
          .row { display: flex; justify-content: space-between; }
          .items td { padding: 1px 0; }
          .items { width: 100%; border-collapse: collapse; }
          .items .desc { max-width: 45mm; word-wrap: break-word; }
          .items .val { text-align: right; white-space: nowrap; }
          .big { font-size: 12px; }
          .small { font-size: 8px; }
          .mt { margin-top: 4px; }
          .mb { margin-bottom: 4px; }
        </style>
      </head>
      <body>
        ${content.innerHTML}
        <script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const nomeFantasia = config?.nome_fantasia || 'Hotel';
  const razaoSocial = config?.razao_social || '';
  const cnpj = config?.cnpj || '';
  const endereco = config
    ? [config.endereco_logradouro, config.endereco_numero, config.endereco_bairro, config.endereco_cidade, config.endereco_uf].filter(Boolean).join(', ')
    : '';
  const telefone = config?.telefone || '';

  const docLabel = invoice.tomador_doc_tipo === 'passaporte' ? 'Passaporte' : invoice.tomador_doc_tipo === 'cnpj' ? 'CNPJ' : 'CPF';
  const statusLabel = invoice.status === 'autorizada' ? 'AUTORIZADA' : invoice.status === 'contingencia' ? 'CONTINGÊNCIA' : invoice.status.toUpperCase();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-gray-500" />
            <span className="font-bold text-sm text-gray-900 dark:text-white">Cupom Fiscal</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Print preview - styled like a thermal receipt */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 font-mono text-[11px] text-gray-900 leading-relaxed" style={{ maxWidth: '300px', margin: '0 auto' }}>
            <div ref={printRef}>
              {/* Header */}
              <div className="center bold big mb">{nomeFantasia}</div>
              {razaoSocial && <div className="center small">{razaoSocial}</div>}
              {cnpj && <div className="center small">CNPJ: {cnpj}</div>}
              {endereco && <div className="center small">{endereco}</div>}
              {telefone && <div className="center small">Tel: {telefone}</div>}

              <div className="line" />

              {/* Document info */}
              <div className="center bold">
                {invoice.tipo === 'nfse' ? 'NFS-e' : 'NF-e'} - {statusLabel}
              </div>
              {invoice.numero_nf && <div className="center">Nº {invoice.numero_nf} · Série {invoice.serie || '1'}</div>}
              {invoice.numero_rps && <div className="center">RPS: {invoice.numero_rps}</div>}
              <div className="center small">{dateStr} {timeStr}</div>
              <div className="center small">Reserva: {invoice.booking_number || '—'} · UH: {invoice.room_description || '—'}</div>

              <div className="line" />

              {/* Tomador */}
              <div className="bold">DESTINATÁRIO</div>
              <div>{invoice.tomador_nome}</div>
              <div>{docLabel}: {invoice.tomador_cpf_cnpj}</div>
              {invoice.tomador_email && <div>{invoice.tomador_email}</div>}
              {invoice.tomador_endereco && <div className="small">{invoice.tomador_endereco}</div>}

              <div className="line" />

              {/* Items */}
              <div className="bold mb">ITENS</div>
              <table className="items">
                <thead>
                  <tr>
                    <td className="bold desc">Descrição</td>
                    <td className="bold val">Qtd</td>
                    <td className="bold val">Valor</td>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td className="desc">{item.descricao}</td>
                      <td className="val">{item.quantidade}</td>
                      <td className="val">{item.valor_total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="line" />

              {/* Total */}
              <div className="row bold big">
                <span>TOTAL</span>
                <span>R$ {Number(invoice.valor_total).toFixed(2)}</span>
              </div>

              <div className="line" />

              {/* Fiscal info */}
              {invoice.chave_acesso && (
                <div className="mt">
                  <div className="bold small">CHAVE DE ACESSO</div>
                  <div className="small" style={{ wordBreak: 'break-all' }}>{invoice.chave_acesso}</div>
                </div>
              )}
              {invoice.numero_protocolo && (
                <div className="mt">
                  <div className="bold small">PROTOCOLO</div>
                  <div className="small">{invoice.numero_protocolo}</div>
                </div>
              )}
              {invoice.codigo_verificacao && (
                <div className="mt">
                  <div className="bold small">CÓD. VERIFICAÇÃO</div>
                  <div className="small">{invoice.codigo_verificacao}</div>
                </div>
              )}

              <div className="line" />
              <div className="center small mt">Documento emitido por sistema</div>
              <div className="center small">LyFe Hoteles - Sistema de Gestão</div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-xs font-bold shadow-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-all"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
};
