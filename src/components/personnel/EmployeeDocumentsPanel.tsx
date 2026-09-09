// src/components/personnel/EmployeeDocumentsPanel.tsx
//
// Documentos de um colaborador, na visão do DP: lista, abertura por URL
// assinada e exclusão com dupla confirmação.
//
// Componente próprio, e não uma aba inline, porque `DPEmployeeDetail.tsx` já
// tem 1400 linhas e é um dos monolitos registrados como débito técnico.
//
// A exclusão é o ponto sensível: apagar um contracheque assinado destrói o
// comprovante de recebimento do colaborador, que é justamente a prova que o
// módulo existe para produzir. Por isso são dois passos — o primeiro exige
// digitar a competência, o segundo pede a confirmação final — e a permissão
// `personnel.payslips.delete` NÃO é herdada da chave grossa do DP.

import React, { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { sanitizeError } from '../../utils/errorHandler';
import {
  listEmployeeDocuments, listDocumentLines, getSignedUrl, deleteDocument,
  type EmployeeDocument, type DocumentLine,
} from '../../lib/employeeDocumentsService';
import {
  FileText, Loader2, AlertTriangle, ExternalLink, FileCheck2, Trash2,
  PenLine, CheckCircle2, ChevronDown, ChevronUp, X, ShieldAlert,
} from 'lucide-react';

interface Props {
  employeeId: string;
  employeeName: string;
}

export default function EmployeeDocumentsPanel({ employeeId, employeeName }: Props) {
  const { can, canAny } = usePermissions();

  const canView = canAny(['personnel_department', 'personnel.payslips.view']);
  const canDelete = can('personnel.payslips.delete');

  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, DocumentLine[]>>({});
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await listEmployeeDocuments(employeeId));
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { if (canView) load(); else setLoading(false); }, [canView, load]);

  async function toggleExpand(doc: EmployeeDocument) {
    if (expandedId === doc.id) { setExpandedId(null); return; }
    setExpandedId(doc.id);
    if (lines[doc.id]) return;
    try {
      const rows = await listDocumentLines(doc.id);
      setLines(prev => ({ ...prev, [doc.id]: rows }));
    } catch {
      setLines(prev => ({ ...prev, [doc.id]: [] }));
    }
  }

  async function openFile(path: string | null) {
    if (!path) return;
    try {
      const url = await getSignedUrl(path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(sanitizeError(err));
    }
  }

  if (!canView) {
    return (
      <Notice
        icon={ShieldAlert}
        title="Sem permissão"
        message="Você não tem a permissão de ver documentos de colaborador. Fale com o administrador."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3.5">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {documents.length === 0 ? (
        <Notice
          icon={FileText}
          title="Nenhum documento"
          message="Envie contracheques em Departamento Pessoal → Documentos → Enviar."
        />
      ) : (
        documents.map(doc => {
          const pending = doc.requires_signature && doc.signature_status === 'pending';
          const expanded = expandedId === doc.id;
          const docLines = lines[doc.id];

          return (
            <div
              key={doc.id}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
            >
              <div className="flex items-center gap-3 p-4">
                <button
                  onClick={() => toggleExpand(doc)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    pending
                      ? 'bg-amber-100 dark:bg-amber-900/30'
                      : 'bg-emerald-100 dark:bg-emerald-900/30'
                  }`}>
                    {pending
                      ? <PenLine className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      : <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {doc.employee_document_types?.name || 'Documento'} · {formatCompetence(doc.reference_month)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {pending
                        ? 'aguardando assinatura'
                        : doc.signed_at
                          ? `assinado em ${new Date(doc.signed_at).toLocaleDateString('pt-BR')}`
                          : 'assinatura não exigida'}
                      {doc.net_pay !== null && ` · líquido ${formatCurrency(doc.net_pay)}`}
                      {doc.parse_status === 'manual' && ' · atribuição conferida à mão'}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <IconButton title="Abrir documento" onClick={() => openFile(doc.file_path)}>
                    <ExternalLink className="h-4 w-4" />
                  </IconButton>
                  {doc.signed_file_path && (
                    <IconButton title="Abrir comprovante assinado" onClick={() => openFile(doc.signed_file_path)} tone="ok">
                      <FileCheck2 className="h-4 w-4" />
                    </IconButton>
                  )}
                  {canDelete && (
                    <IconButton title="Excluir documento" onClick={() => setDeleting(doc)} tone="danger">
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  )}
                  <button onClick={() => toggleExpand(doc)} className="p-2 text-gray-400" aria-label="Detalhar">
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900 space-y-3">
                  {docLines === undefined ? (
                    <div className="flex justify-center py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    </div>
                  ) : docLines.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          <th className="text-left pb-2">Cód.</th>
                          <th className="text-left pb-2">Descrição</th>
                          <th className="text-left pb-2">Ref.</th>
                          <th className="text-right pb-2">Vencimentos</th>
                          <th className="text-right pb-2">Descontos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docLines.map(l => (
                          <tr key={l.id} className="border-t border-gray-200 dark:border-gray-700">
                            <td className="py-2 text-gray-400 font-mono text-xs">{l.code || ''}</td>
                            <td className="py-2 text-gray-800 dark:text-white">{l.description}</td>
                            <td className="py-2 text-gray-500 dark:text-gray-400 text-xs tabular-nums">{l.reference || ''}</td>
                            <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                              {l.earning !== null ? formatCurrency(l.earning) : ''}
                            </td>
                            <td className="py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                              {l.deduction !== null ? formatCurrency(l.deduction) : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-gray-400">Sem detalhamento de verbas para este documento.</p>
                  )}

                  {/* Bases e origem */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <Cell label="Vencimentos" value={doc.total_earnings} />
                    <Cell label="Descontos" value={doc.total_deductions} />
                    <Cell label="Líquido" value={doc.net_pay} />
                    <Cell label="Base FGTS" value={doc.base_fgts} />
                  </div>

                  <p className="text-xs text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-700">
                    {doc.employer_name
                      ? <>Emitido por {doc.employer_name}{doc.employer_cnpj ? ` (${doc.employer_cnpj})` : ''}</>
                      : 'Empregador não identificado no arquivo'}
                    {doc.source_file_name && <> · origem: {doc.source_file_name}{doc.source_page ? ` p.${doc.source_page}` : ''}</>}
                  </p>
                </div>
              )}
            </div>
          );
        })
      )}

      {deleting && (
        <DeleteDocumentDialog
          doc={deleting}
          employeeName={employeeName}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Exclusão em dois passos ──────────────────────────────────────────────────

function DeleteDocumentDialog({ doc, employeeName, onClose, onDeleted }: {
  doc: EmployeeDocument;
  employeeName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const competence = formatCompetence(doc.reference_month);

  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signed = doc.signature_status === 'signed';
  // Digitar a competência força a pessoa a olhar QUAL documento está apagando —
  // um "tem certeza?" seco é clicado no automático.
  const typedOk = typed.trim() === competence;

  async function handleDelete() {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await deleteDocument(doc);
      onDeleted();
    } catch (err) {
      setError(sanitizeError(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">
            {step === 1 ? 'Excluir documento' : 'Confirmação final'}
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {step === 1 ? (
            <>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3.5 space-y-1.5 text-sm">
                <Row label="Documento" value={doc.employee_document_types?.name || 'Documento'} />
                <Row label="Competência" value={competence} />
                <Row label="Colaborador" value={employeeName} />
                <Row label="Assinatura" value={signed ? 'JÁ ASSINADO pelo colaborador' : 'pendente'} />
                {doc.net_pay !== null && <Row label="Líquido" value={formatCurrency(doc.net_pay)} />}
              </div>

              {signed && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3.5">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Este documento já foi assinado. Excluir destrói o comprovante de recebimento —
                    a assinatura, a data e o arquivo assinado somem, e o colaborador teria de
                    assinar de novo um documento reenviado.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Para continuar, digite a competência <span className="font-mono text-gray-700 dark:text-gray-200">{competence}</span>
                </label>
                <input
                  type="text"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder={competence}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3.5">
              <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="text-sm text-rose-700 dark:text-rose-300 space-y-1.5">
                <p className="font-bold">Esta ação não pode ser desfeita.</p>
                <p>
                  Serão apagados do sistema: o arquivo do documento
                  {doc.signed_file_path && ', o comprovante assinado'}
                  {signed && ', a assinatura registrada'} e o detalhamento das verbas.
                </p>
                <p>Não há lixeira nem backup recuperável pela interface.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3">
              <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={step === 1 ? onClose : () => setStep(1)}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!typedOk}
              className="flex-1 px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold shadow-sm disabled:opacity-40"
            >
              Continuar
            </button>
          ) : (
            <button
              onClick={handleDelete}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold shadow-sm disabled:opacity-60"
            >
              {isSaving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Excluindo...</>
                : <><Trash2 className="h-4 w-4" /> Excluir definitivamente</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Peças de UI ──────────────────────────────────────────────────────────────

function IconButton({ title, onClick, tone = 'neutral', children }: {
  title: string;
  onClick: () => void;
  tone?: 'neutral' | 'ok' | 'danger';
  children: React.ReactNode;
}) {
  const tones = {
    neutral: 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700',
    ok: 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
    danger: 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20',
  };
  return (
    <button onClick={onClick} title={title} aria-label={title} className={`p-2 rounded-xl transition-colors ${tones[tone]}`}>
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-white text-right">{value}</span>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-2.5 text-center">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
        {value === null || value === undefined ? '—' : formatCurrency(value)}
      </p>
    </div>
  );
}

function Notice({ icon: Icon, title, message }: { icon: any; title: string; message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center shadow-sm">
      <Icon className="h-10 w-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto">{message}</p>
    </div>
  );
}

function formatCompetence(reference: string | null): string {
  if (!reference) return 'sem competência';
  const [year, month] = reference.split('-');
  return `${month}/${year}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
