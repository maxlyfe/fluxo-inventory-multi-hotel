// src/pages/portal/MyPayslips.tsx
//
// Contracheques e documentos do próprio colaborador, com assinatura virtual.
//
// Diferença deliberada em relação a `MyDocuments.tsx`: aqui o colaborador é
// resolvido SÓ por `user_id`, sem `hotel_id = selectedHotel`. Naquela tela, quem
// está cadastrado numa unidade e com outra selecionada vê "conta não vinculada";
// para contracheque isso seria pior que um estado vazio, porque pareceria que a
// empresa não pagou. Ver `resolveMyEmployee` em employeeDocumentsService.ts.
//
// A tela não filtra por unidade em nenhum ponto: o documento pode ter sido
// emitido no CNPJ de outra unidade do grupo, e isso é normal na operação.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { sanitizeError } from '../../utils/errorHandler';
import {
  resolveMyEmployee,
  listEmployeeDocuments,
  listDocumentLines,
  getSignedUrl,
  type EmployeeDocument,
  type DocumentLine,
  type GroupEmployee,
} from '../../lib/employeeDocumentsService';
import EmployeeDocumentSignModal from '../../components/personnel/EmployeeDocumentSignModal';
import {
  Receipt, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  PenLine, CheckCircle2, ExternalLink, FileCheck2,
} from 'lucide-react';

export default function MyPayslips() {
  const { user } = useAuth();

  const [employee, setEmployee] = useState<GroupEmployee | null>(null);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, DocumentLine[]>>({});
  const [signing, setSigning] = useState<EmployeeDocument | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const emp = await resolveMyEmployee(user.id);
      setEmployee(emp);
      setDocuments(emp ? await listEmployeeDocuments(emp.id) : []);
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  /** Carrega as verbas só quando o colaborador abre o documento. */
  async function toggleExpand(doc: EmployeeDocument) {
    if (expandedId === doc.id) { setExpandedId(null); return; }
    setExpandedId(doc.id);
    if (lines[doc.id]) return;
    try {
      const rows = await listDocumentLines(doc.id);
      setLines(prev => ({ ...prev, [doc.id]: rows }));
    } catch {
      // Sem as verbas a tela ainda serve: o documento em si continua abrindo.
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

  /** Agrupado por ano, do mais recente para o mais antigo. */
  const byYear = useMemo(() => {
    const groups = new Map<string, EmployeeDocument[]>();
    for (const doc of documents) {
      const year = doc.reference_month?.slice(0, 4) || 'Sem competência';
      const list = groups.get(year) || [];
      list.push(doc);
      groups.set(year, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [documents]);

  const pendingCount = documents.filter(
    d => d.requires_signature && d.signature_status === 'pending',
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Conta não vinculada</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sua conta de usuário não está vinculada a um colaborador. Preencha o seu CPF no perfil ou
          fale com o Departamento Pessoal.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <Receipt className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Meus Contracheques</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {employee.name}{employee.sector ? ` · ${employee.sector}` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3.5 mb-4">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3.5 mb-4">
          <PenLine className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
            {pendingCount === 1
              ? 'Você tem 1 documento aguardando sua assinatura.'
              : `Você tem ${pendingCount} documentos aguardando sua assinatura.`}
          </p>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center shadow-sm">
          <Receipt className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum documento disponível ainda</p>
        </div>
      ) : (
        <div className="space-y-6">
          {byYear.map(([year, docs]) => (
            <div key={year}>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3">
                {year}
                <span className="ml-2 text-xs font-normal text-slate-400">({docs.length})</span>
              </h3>
              <div className="space-y-3">
                {docs.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    expanded={expandedId === doc.id}
                    lines={lines[doc.id]}
                    onToggle={() => toggleExpand(doc)}
                    onSign={() => setSigning(doc)}
                    onOpen={openFile}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {signing && (
        <EmployeeDocumentSignModal
          document={signing}
          employee={employee}
          docTypeLabel={signing.employee_document_types?.name || 'Documento'}
          onClose={() => setSigning(null)}
          onSigned={load}
        />
      )}
    </div>
  );
}

// ── Card de um documento ─────────────────────────────────────────────────────

interface CardProps {
  doc: EmployeeDocument;
  expanded: boolean;
  lines: DocumentLine[] | undefined;
  onToggle: () => void;
  onSign: () => void;
  onOpen: (path: string | null) => void;
}

function DocumentCard({ doc, expanded, lines, onToggle, onSign, onOpen }: CardProps) {
  const pending = doc.requires_signature && doc.signature_status === 'pending';
  const typeLabel = doc.employee_document_types?.name || 'Documento';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            pending
              ? 'bg-amber-100 dark:bg-amber-900/30'
              : 'bg-emerald-100 dark:bg-emerald-900/30'
          }`}>
            {pending
              ? <PenLine className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              : <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
              {typeLabel} · {formatCompetence(doc.reference_month)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pending
                ? 'Aguardando sua assinatura'
                : doc.signed_at
                  ? `Assinado em ${new Date(doc.signed_at).toLocaleDateString('pt-BR')}`
                  : 'Sem assinatura exigida'}
              {doc.net_pay !== null && ` · líquido ${formatCurrency(doc.net_pay)}`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-900 space-y-3">
          {/* Verbas */}
          {lines === undefined ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          ) : lines.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="text-left pb-2">Descrição</th>
                  <th className="text-right pb-2">Vencimentos</th>
                  <th className="text-right pb-2">Descontos</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
                  <tr key={line.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="py-2 text-slate-800 dark:text-white">
                      {line.description}
                      {line.reference && (
                        <span className="ml-1.5 text-xs text-slate-400">{line.reference}</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {line.earning !== null ? formatCurrency(line.earning) : ''}
                    </td>
                    <td className="py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                      {line.deduction !== null ? formatCurrency(line.deduction) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-bold">
                  <td className="pt-2 text-slate-800 dark:text-white">Totais</td>
                  <td className="pt-2 text-right tabular-nums text-slate-800 dark:text-white">
                    {doc.total_earnings !== null ? formatCurrency(doc.total_earnings) : '—'}
                  </td>
                  <td className="pt-2 text-right tabular-nums text-slate-800 dark:text-white">
                    {doc.total_deductions !== null ? formatCurrency(doc.total_deductions) : '—'}
                  </td>
                </tr>
                {doc.net_pay !== null && (
                  <tr>
                    <td colSpan={2} className="pt-1 text-slate-600 dark:text-slate-300">Valor líquido</td>
                    <td className="pt-1 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                      {formatCurrency(doc.net_pay)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Sem detalhamento de verbas — abra o documento para ver o original.
            </p>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => onOpen(doc.file_path)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Ver documento
            </button>

            {doc.signed_file_path && (
              <button
                onClick={() => onOpen(doc.signed_file_path)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              >
                <FileCheck2 className="h-3.5 w-3.5" /> Comprovante assinado
              </button>
            )}

            {pending && (
              <button
                onClick={onSign}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold shadow-sm"
              >
                <PenLine className="h-3.5 w-3.5" /> Assinar
              </button>
            )}
          </div>

          {/* Emitido por outra unidade — informação, não erro */}
          {doc.employer_name && (
            <p className="text-xs text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
              Emitido por {doc.employer_name}
              {doc.employer_cnpj ? ` (${doc.employer_cnpj})` : ''}
            </p>
          )}
        </div>
      )}
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
