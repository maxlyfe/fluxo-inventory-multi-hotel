// src/components/personnel/EmployeeDocumentSignModal.tsx
//
// Assinatura virtual de um documento do colaborador, no Portal.
//
// Reusa a mecânica do web check-in, mas a variante do fluxo MOBILE
// (`WCICompanionEntry`), não a do totem: `react-signature-canvas` com o canvas
// dimensionado por CSS e `touchAction: 'none'`. A versão do totem
// (`WCISignatureAndTerms`) tem bitmap fixo de 600px escalado por CSS, o que
// distorce o traço em tela estreita — e aqui o uso principal é o celular do
// colaborador.

import { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { X, Loader2, Eraser, ShieldCheck, AlertTriangle } from 'lucide-react';
import { sanitizeError } from '../../utils/errorHandler';
import {
  getSignedUrl,
  signDocument,
  uploadSignedPdf,
  signedPdfPath,
  type EmployeeDocument,
} from '../../lib/employeeDocumentsService';
import { buildSignedPdf } from '../../lib/signedDocumentPdf';

interface Props {
  document: EmployeeDocument;
  employee: { name: string; cpf?: string | null; payroll_code?: string | null; sector?: string | null };
  docTypeLabel: string;
  onClose: () => void;
  /** Chamado depois da assinatura gravada, para a lista recarregar. */
  onSigned: () => void;
}

export default function EmployeeDocumentSignModal({
  document: doc, employee, docTypeLabel, onClose, onSigned,
}: Props) {
  const sigRef = useRef<SignatureCanvas>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const url = await getSignedUrl(doc.file_path);
        if (active) setPreviewUrl(url);
      } catch (err) {
        if (active) setError(sanitizeError(err));
      } finally {
        if (active) setLoadingPreview(false);
      }
    })();
    return () => { active = false; };
  }, [doc.file_path]);

  async function handleSign() {
    // Trava de duplo clique — convenção obrigatória do projeto para escrita.
    if (isSaving) return;

    if (!accepted) {
      setError('Marque a declaração de recebimento antes de assinar.');
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError('Assine no quadro antes de confirmar.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // getTrimmedCanvas recorta o espaço em branco em volta do traço: sem
      // isso, a rubrica sai minúscula dentro de um retângulo do tamanho da tela.
      const signatureDataUrl = sigRef.current.getTrimmedCanvas().toDataURL('image/png');
      const signedAt = new Date();

      setStep('Montando o comprovante...');
      const pageImage = previewUrl ? await urlToDataUrl(previewUrl) : null;
      const pdfBlob = await buildSignedPdf({
        pageImages: pageImage ? [pageImage] : [],
        document: doc,
        employee,
        signatureDataUrl,
        signedAt,
        docTypeLabel,
      });

      // A ordem importa: a policy do bucket confere o caminho contra
      // `signed_file_path`, que só existe depois da RPC. Assinar primeiro,
      // subir depois.
      setStep('Registrando a assinatura...');
      const path = signedPdfPath(doc);
      await signDocument({ documentId: doc.id, signatureDataUrl, signedFilePath: path });

      setStep('Guardando o comprovante...');
      // Se este passo falhar, a assinatura já está registrada e a rubrica está
      // no banco: o comprovante pode ser gerado de novo, e o colaborador não
      // precisa assinar outra vez. Por isso o erro aqui não desfaz nada.
      await uploadSignedPdf({ document: doc, pdfBlob });

      onSigned();
      onClose();
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setIsSaving(false);
      setStep(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 w-full sm:max-w-2xl max-h-[95vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Assinar {docTypeLabel}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatCompetence(doc.reference_month)} · {employee.name}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Documento */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-hidden">
            {loadingPreview ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : previewUrl ? (
              <img src={previewUrl} alt={`${docTypeLabel} de ${formatCompetence(doc.reference_month)}`} className="w-full" />
            ) : (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-gray-500 dark:text-gray-400">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Não foi possível carregar o documento. Fale com o DP antes de assinar.
              </div>
            )}
          </div>

          {/* Resumo dos valores, quando lidos */}
          {(doc.total_earnings !== null || doc.net_pay !== null) && (
            <div className="grid grid-cols-3 gap-2">
              <SummaryCell label="Vencimentos" value={doc.total_earnings} tone="text-emerald-600 dark:text-emerald-400" />
              <SummaryCell label="Descontos" value={doc.total_deductions} tone="text-rose-600 dark:text-rose-400" />
              <SummaryCell label="Líquido" value={doc.net_pay} tone="text-gray-900 dark:text-white" />
            </div>
          )}

          {/* Declaração */}
          <label className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Declaro ter recebido a importância líquida discriminada neste documento e estar de
              acordo com os valores apresentados.
            </span>
          </label>

          {/* Assinatura */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-gray-800 dark:text-white">Sua assinatura</span>
              <button
                type="button"
                onClick={() => sigRef.current?.clear()}
                disabled={isSaving}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40"
              >
                <Eraser className="h-3.5 w-3.5" /> Limpar
              </button>
            </div>
            <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 overflow-hidden">
              <SignatureCanvas
                ref={sigRef}
                penColor="#1a1a2e"
                canvasProps={{ style: { width: '100%', height: 170, display: 'block', touchAction: 'none' } }}
              />
            </div>
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
              Assine com o dedo ou o mouse. Depois de assinado, o documento não pode ser alterado.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3">
              <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleSign}
            disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold shadow-sm disabled:opacity-60"
          >
            {isSaving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {step || 'Assinando...'}</>
              : <><ShieldCheck className="h-4 w-4" /> Assinar documento</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-2.5 text-center">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone}`}>
        {value === null || value === undefined
          ? '—'
          : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>
    </div>
  );
}

/**
 * Baixa a imagem da URL assinada e devolve como dataURL.
 *
 * O jsPDF precisa dos bytes: passar a URL direto depende de CORS e falha em
 * silêncio, produzindo um PDF com a página em branco.
 */
async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Falha ao carregar o documento para assinatura');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o documento'));
    reader.readAsDataURL(blob);
  });
}

function formatCompetence(reference: string | null): string {
  if (!reference) return 'sem competência';
  const [year, month] = reference.split('-');
  return `${month}/${year}`;
}
