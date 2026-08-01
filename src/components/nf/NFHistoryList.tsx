// src/components/nf/NFHistoryList.tsx
// Histórico fiscal de uma reserva — TODAS as notas, inclusive canceladas e
// rejeitadas. Cancelar ou ter a nota recusada libera nova emissão, mas o
// documento continua visível: quem confere o portal da prefeitura precisa
// encontrar aqui o que foi emitido, quando, e por que deixou de valer.
// Usado pela página de Emissão de NF e pelo extrato da reserva.
import React from 'react';
import { Eye, Download, RefreshCw, FileCheck2 } from 'lucide-react';
import { isNFValida } from '../../lib/nfService';
import type { NFInvoice, NFTipo } from '../../types/nf';

interface NFHistoryListProps {
  invoices: NFInvoice[];
  onView: (invoiceId: string, tipo: NFTipo) => void;
  /** Reconsulta de NFS-e aceita mas sem número (Plataforma Nacional) */
  onReconsultar?: (invoiceId: string) => void;
  reconsultandoId?: string | null;
  /** Título do bloco; passe null para não renderizar cabeçalho */
  title?: string | null;
}

const TIPO_LABEL: Record<string, string> = { nfse: 'NFS-e', nfce: 'NFC-e', nfe: 'NF-e' };

interface StatusVisual { label: string; chip: string; card: string }

export function statusVisual(inv: NFInvoice): StatusVisual {
  switch (inv.status) {
    case 'autorizada':
      return {
        label: 'Autorizada',
        chip: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
        card: 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30',
      };
    case 'contingencia':
      return {
        label: 'Contingência',
        chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        card: 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30',
      };
    case 'emitida':
      return {
        label: inv.numero_nf ? 'Emitida' : 'Aguardando número',
        chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
        card: 'bg-sky-50 dark:bg-sky-900/10 border-sky-100 dark:border-sky-900/30',
      };
    case 'cancelada':
      return {
        label: 'Cancelada',
        chip: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        card: 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30',
      };
    case 'rejeitada':
      return {
        label: 'Rejeitada',
        chip: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
        card: 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
      };
    default:
      return {
        label: inv.status,
        chip: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
        card: 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
      };
  }
}

/** Motivo em uma linha: cancelamento manual, ou a primeira mensagem de recusa
 *  do fisco. O retorno vem em dois formatos — XML ABRASF (prefeitura) e JSON da
 *  Plataforma Nacional —, então os dois são tratados. */
export function motivoResumo(inv: NFInvoice): string | null {
  if (inv.status === 'cancelada') return inv.motivo_cancelamento || 'Cancelada';
  if (inv.status !== 'rejeitada') return null;

  const raw = inv.xml_retorno || '';
  if (!raw) return 'Recusada pelo fisco';

  if (raw.trimStart().startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      const erro = Array.isArray(j.erros) ? j.erros[0] : null;
      if (erro) {
        const cod = erro.codigo ? `${erro.codigo} · ` : '';
        return `${cod}${erro.descricao || erro.mensagem || 'Recusada pelo fisco'}`;
      }
    } catch {
      // Retorno truncado ou fora do formato: cai no texto genérico abaixo.
    }
    return 'Recusada pelo fisco';
  }

  const cod = raw.match(/<Codigo>([^<]+)<\/Codigo>/)?.[1];
  const msg = raw.match(/<Mensagem>([^<]+)<\/Mensagem>/)?.[1];
  if (msg) return `${cod ? `${cod} · ` : ''}${msg}`;
  return 'Recusada pelo fisco';
}

function baixarArquivo(conteudo: string, nomeArquivo: string, mime: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

export const NFHistoryList: React.FC<NFHistoryListProps> = ({
  invoices, onView, onReconsultar, reconsultandoId, title = 'Histórico fiscal desta reserva',
}) => {
  if (invoices.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {title && (
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          <FileCheck2 className="w-3.5 h-3.5" /> {title} ({invoices.length})
        </p>
      )}
      {invoices.map(inv => {
        const vis = statusVisual(inv);
        const motivo = motivoResumo(inv);
        // A NFS-e aceita pela Plataforma Nacional pode ficar sem número até a
        // reconsulta trazer chave e XML autorizado.
        const podeReconsultar = !!onReconsultar
          && inv.tipo === 'nfse'
          && isNFValida(inv)
          && !inv.numero_nf
          && !inv.chave_acesso
          && !!(inv.id_dps || inv.xml_retorno?.includes('idDPS'));

        return (
          <div key={inv.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border ${vis.card}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  {TIPO_LABEL[inv.tipo] || inv.tipo}
                  {inv.numero_nf ? ` · Nº ${inv.numero_nf}` : ''}
                  {inv.serie ? `/${inv.serie}` : ''}
                </span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${vis.chip}`}>
                  {vis.label}
                </span>
              </div>
              <span className="block text-[11px] text-gray-400 truncate">
                {inv.created_at ? new Date(inv.created_at).toLocaleString('pt-BR') : ''}
                {inv.valor_total != null ? ` · R$ ${Number(inv.valor_total).toFixed(2)}` : ''}
                {inv.cancelada_em ? ` · cancelada em ${new Date(inv.cancelada_em).toLocaleString('pt-BR')}` : ''}
              </span>
              {motivo && (
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2" title={motivo}>
                  {motivo}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onView(inv.id, inv.tipo)}
                title="Ver a nota, imprimir e baixar o documento"
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Ver
              </button>
              {podeReconsultar && (
                <button
                  onClick={() => onReconsultar?.(inv.id)}
                  title="A NFS-e foi aceita e ainda está em processamento. Reconsulte para trazer número, chave e XML autorizado."
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reconsultandoId === inv.id ? 'animate-spin' : ''}`} /> Reconsultar
                </button>
              )}
              {inv.xml_retorno && (
                <button
                  onClick={() => {
                    // `xml_retorno` nem sempre é XML: em processamento ou em
                    // recusa a Plataforma Nacional devolve JSON.
                    const ehXml = inv.xml_retorno!.trimStart().startsWith('<');
                    baixarArquivo(
                      inv.xml_retorno!,
                      `NF_${inv.numero_nf || inv.id}.${ehXml ? 'xml' : 'json'}`,
                      ehXml ? 'application/xml' : 'application/json',
                    );
                  }}
                  title={inv.xml_retorno.trimStart().startsWith('<') ? 'Baixar o XML da nota' : 'Baixar o retorno da API'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> {inv.xml_retorno.trimStart().startsWith('<') ? 'XML' : 'Retorno'}
                </button>
              )}
              {inv.xml_dps && (
                <button
                  onClick={() => baixarArquivo(inv.xml_dps!, `DPS_${inv.numero_nf || inv.id}.xml`, 'application/xml')}
                  title="XML assinado enviado à Plataforma Nacional"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> DPS
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NFHistoryList;
