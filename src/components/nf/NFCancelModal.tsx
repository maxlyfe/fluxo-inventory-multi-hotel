// src/components/nf/NFCancelModal.tsx
// Cancelamento de nota fiscal, nos dois caminhos que a operação usa de verdade:
//  1. cancelar pelo sistema (evento no fisco: prefeitura, Plataforma Nacional
//     ou SEFAZ, conforme o tipo/provedor da nota);
//  2. registrar um cancelamento que já foi feito fora (portal da prefeitura,
//     contador) — sem isso o sistema seguia mostrando como válida uma nota que
//     já não existia mais, e o histórico ficava mentindo.
// Nos dois casos a nota permanece no histórico da reserva, com data e motivo.
import React, { useState } from 'react';
import { X, AlertTriangle, Loader2, Ban, ClipboardCheck } from 'lucide-react';
import { nfService } from '../../lib/nfService';
import { useAuth } from '../../context/AuthContext';
import type { NFInvoice } from '../../types/nf';

interface NFCancelModalProps {
  invoice: NFInvoice;
  onClose: () => void;
  /** Chamado depois de cancelar/registrar com sucesso (recarregar a lista) */
  onDone: () => void;
}

type Modo = 'fisco' | 'externo';

// A SEFAZ exige justificativa de 15 a 255 caracteres no evento de cancelamento;
// a mesma régua vale para a NFS-e, que não valida tamanho mas guarda o texto.
const MOTIVO_MIN = 15;
const MOTIVO_MAX = 255;

const TIPO_LABEL: Record<string, string> = { nfse: 'NFS-e', nfce: 'NFC-e', nfe: 'NF-e' };

export const NFCancelModal: React.FC<NFCancelModalProps> = ({ invoice, onClose, onDone }) => {
  const { user } = useAuth();
  const [modo, setModo] = useState<Modo>('fisco');
  const [motivo, setMotivo] = useState('');
  const [dataExterna, setDataExterna] = useState(() => new Date().toISOString().slice(0, 10));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const motivoOk = motivo.trim().length >= MOTIVO_MIN && motivo.trim().length <= MOTIVO_MAX;

  async function confirmar() {
    if (!motivoOk || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const res = modo === 'fisco'
        ? await nfService.cancelInvoice(invoice.id, motivo.trim(), user?.id ?? null)
        : await nfService.registrarCancelamentoExterno(
            invoice.id,
            motivo.trim(),
            user?.id ?? null,
            // Data informada pelo operador: o cancelamento no portal pode ter
            // sido feito dias antes de alguém registrar aqui.
            new Date(`${dataExterna}T12:00:00`).toISOString(),
          );
      if (!res.success) {
        setErro(res.message);
        return;
      }
      onDone();
      onClose();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
            <Ban className="w-5 h-5 text-red-600" />
            Cancelar {TIPO_LABEL[invoice.tipo] || invoice.tipo}
            {invoice.numero_nf ? ` nº ${invoice.numero_nf}` : ''}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            <p className="font-medium text-gray-900 dark:text-white">{invoice.tomador_nome}</p>
            <p className="text-xs text-gray-500">
              {invoice.booking_number ? `Reserva ${invoice.booking_number} · ` : ''}
              R$ {Number(invoice.valor_total).toFixed(2)}
              {invoice.created_at ? ` · emitida em ${new Date(invoice.created_at).toLocaleDateString('pt-BR')}` : ''}
            </p>
          </div>

          {/* Escolha do caminho */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => setModo('fisco')}
              className={`text-left p-3 rounded-xl border transition-all ${
                modo === 'fisco'
                  ? 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-700'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
                <Ban className="w-4 h-4" /> Cancelar pelo sistema
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Envia o cancelamento ao fisco agora e registra o retorno.
              </span>
            </button>
            <button
              onClick={() => setModo('externo')}
              className={`text-left p-3 rounded-xl border transition-all ${
                modo === 'externo'
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
                <ClipboardCheck className="w-4 h-4" /> Já cancelei fora
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Só registra aqui um cancelamento feito no portal ou pelo contador.
              </span>
            </button>
          </div>

          {modo === 'externo' && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                Data do cancelamento
              </label>
              <input
                type="date"
                value={dataExterna}
                onChange={e => setDataExterna(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Motivo do cancelamento
            </label>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value.slice(0, MOTIVO_MAX))}
              rows={3}
              placeholder="Ex.: nota emitida em duplicidade para a mesma reserva"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
            />
            <p className={`text-[11px] mt-1 ${motivoOk ? 'text-gray-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {motivo.trim().length}/{MOTIVO_MAX} · mínimo de {MOTIVO_MIN} caracteres (exigência do fisco)
            </p>
          </div>

          {modo === 'fisco' && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                O cancelamento vale se o fisco aceitar: NFC-e/NF-e têm prazo curto depois da autorização, e a
                prefeitura tem regra própria de prazo. Se o fisco recusar, a nota continua válida aqui e a
                mensagem de recusa aparece nesta tela.
              </p>
            </div>
          )}

          {erro && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-xs font-bold text-red-700 dark:text-red-400">Não foi possível cancelar</p>
              <p className="text-xs text-red-600 dark:text-red-300 mt-0.5 whitespace-pre-wrap">{erro}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Fechar
          </button>
          <button
            onClick={confirmar}
            disabled={!motivoOk || enviando}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              modo === 'fisco' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            {modo === 'fisco' ? 'Cancelar no fisco' : 'Registrar cancelamento'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NFCancelModal;
