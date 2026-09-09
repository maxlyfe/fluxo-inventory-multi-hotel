// src/pages/dp/DPDocuments.tsx
//
// Documentos do colaborador no DP: envio em lote com conciliação, e painel de
// acompanhamento das assinaturas.
//
// O envio aceita um arquivo por colaborador ou o lote inteiro num arquivo só.
// Toda página vira uma linha de conciliação: o sistema lê matrícula, nome,
// competência e verbas, sugere o colaborador e o DP confere antes de gravar.
//
// Nada aqui filtra por unidade selecionada, e isso é a regra do módulo, não
// esquecimento: o contracheque pode sair no CNPJ de uma unidade com a pessoa
// cadastrada em outra. O escopo é o GRUPO (`listGroupEmployees`).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useGroup } from '../../context/GroupContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useGroupHotels } from '../../hooks/useGroupHotels';
import { sanitizeError } from '../../utils/errorHandler';
import { searchMatchAll } from '../../utils/search';
import { renderPdfPages, imageToPdfPage, type PdfPage } from '../../lib/pdfjsLoader';
import {
  parsePayslip, matchEmployee, HIGH_CONFIDENCE,
  type ParsedPayslip, type MatchReason,
} from '../../lib/payslipParser';
import {
  listDocumentTypes, listGroupEmployees, listGroupDocuments,
  createDocumentWithFile, base64ToBlob,
  type EmployeeDocumentType, type GroupEmployee, type EmployeeDocument,
} from '../../lib/employeeDocumentsService';
import DPDocumentTypes from './DPDocumentTypes';
import {
  Upload, FileText, Loader2, AlertTriangle, CheckCircle2, X, Search,
  Settings, PenLine, Building2, ChevronRight,
} from 'lucide-react';

type SubTab = 'send' | 'panel' | 'types';

/** Uma página de arquivo esperando conciliação. */
interface ReviewRow {
  key: string;
  sourceFileName: string;
  page: PdfPage;
  parsed: ParsedPayslip;
  employeeId: string | null;
  confidence: number;
  reason: MatchReason;
  ambiguous: boolean;
  /** Fora da conciliação: o DP marcou para não gravar. */
  skipped: boolean;
  status: 'pending' | 'saving' | 'saved' | 'error';
  errorMessage?: string;
}

export default function DPDocuments() {
  const { can, canAny } = usePermissions();

  const canUpload = canAny(['personnel_department', 'personnel.payslips.upload']);
  const canManageTypes = can('personnel.doctypes.manage');

  const [tab, setTab] = useState<SubTab>(canUpload ? 'send' : 'panel');

  const tabs: { id: SubTab; label: string; icon: any; visible: boolean }[] = [
    { id: 'send', label: 'Enviar', icon: Upload, visible: canUpload },
    { id: 'panel', label: 'Painel', icon: FileText, visible: true },
    { id: 'types', label: 'Tipos', icon: Settings, visible: canManageTypes },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl">
        {tabs.filter(t => t.visible).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex-1 justify-center ${
                tab === t.id
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'send' && canUpload && <SendTab />}
      {tab === 'panel' && <PanelTab />}
      {tab === 'types' && canManageTypes && <DPDocumentTypes />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aba Enviar — leitura e conciliação
// ═══════════════════════════════════════════════════════════════════════════

function SendTab() {
  const { user } = useAuth();
  const { currentGroup } = useGroup();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [types, setTypes] = useState<EmployeeDocumentType[]>([]);
  const [employees, setEmployees] = useState<GroupEmployee[]>([]);
  const [docTypeId, setDocTypeId] = useState('');
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [reading, setReading] = useState(false);
  const [readProgress, setReadProgress] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [t, e] = await Promise.all([
          listDocumentTypes(currentGroup?.id),
          listGroupEmployees(currentGroup?.id),
        ]);
        if (!active) return;
        setTypes(t);
        setEmployees(e);
        // Contracheque é o caso de uso principal: já vem selecionado.
        setDocTypeId(t.find(x => x.is_payslip)?.id || t[0]?.id || '');
      } catch (err) {
        if (active) setError(sanitizeError(err));
      } finally {
        if (active) setLoadingRefs(false);
      }
    })();
    return () => { active = false; };
  }, [currentGroup?.id]);

  const selectedType = types.find(t => t.id === docTypeId) || null;
  const employeeById = useMemo(
    () => new Map(employees.map(e => [e.id, e])),
    [employees],
  );

  /** Lê os arquivos escolhidos e monta as linhas de conciliação. */
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    setError(null);

    const collected: ReviewRow[] = [];

    try {
      for (const file of Array.from(files)) {
        setReadProgress(`Lendo ${file.name}...`);

        let pages: PdfPage[] = [];
        try {
          if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
            pages = await renderPdfPages(file, { scale: 2 });
          } else if (file.type.startsWith('image/')) {
            pages = [await imageToPdfPage(file)];
          } else {
            collected.push(unreadableRow(file.name, `Formato não suportado: ${file.type || 'desconhecido'}`));
            continue;
          }
        } catch (err) {
          collected.push(unreadableRow(file.name, sanitizeError(err)));
          continue;
        }

        for (const page of pages) {
          // Só o tipo marcado como contracheque roda o parser: nos outros o
          // layout é desconhecido e uma leitura chutada seria pior que nenhuma.
          const parsed = selectedType?.is_payslip
            ? parsePayslip(page.lines)
            : emptyParsed('Tipo de documento sem leitura automática — atribuição manual.');

          const match = matchEmployee(parsed, employees);

          collected.push({
            key: `${file.name}#${page.pageNumber}`,
            sourceFileName: file.name,
            page,
            parsed,
            employeeId: match.employee?.id ?? null,
            confidence: match.confidence,
            reason: match.reason,
            ambiguous: match.ambiguous,
            skipped: false,
            status: 'pending',
          });
        }
      }

      setRows(prev => [...prev, ...collected]);
    } finally {
      setReading(false);
      setReadProgress(null);
      // Permite reenviar o mesmo arquivo depois de limpar a lista.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }

  const toSave = rows.filter(r => !r.skipped && r.employeeId && r.status !== 'saved');
  const highConfidence = rows.filter(
    r => !r.skipped && r.employeeId && !r.ambiguous && r.confidence >= HIGH_CONFIDENCE && r.status === 'pending',
  );
  const unmatched = rows.filter(r => !r.skipped && !r.employeeId);

  async function handleSaveAll() {
    // Trava de duplo clique — cada linha vira arquivo no storage, e um clique
    // duplo criaria documento repetido antes de a unique do banco reclamar.
    if (isSaving || !currentGroup?.id || !selectedType) return;

    setIsSaving(true);
    setError(null);

    for (const row of toSave) {
      const employee = employeeById.get(row.employeeId!);
      if (!employee) {
        updateRow(row.key, { status: 'error', errorMessage: 'Colaborador não encontrado na lista do grupo.' });
        continue;
      }

      updateRow(row.key, { status: 'saving', errorMessage: undefined });

      try {
        const blob = base64ToBlob(row.page.jpegDataUrl, 'image/jpeg');
        const competence = row.parsed.referenceMonth;
        const label = competence ? competence.slice(0, 7) : 'sem-competencia';

        await createDocumentWithFile(
          {
            employeeId: employee.id,
            // A unidade do documento é a do CADASTRO, não a do CNPJ que emitiu:
            // é ela que a RLS usa para decidir quem do grupo pode ler.
            hotelId: employee.hotel_id,
            groupId: currentGroup.id,
            docTypeId: selectedType.id,
            requiresSignature: selectedType.requires_signature,
            referenceMonth: competence,
            periodStart: row.parsed.periodStart,
            periodEnd: row.parsed.periodEnd,
            fileName: `${selectedType.slug}-${label}.jpg`,
            contentType: 'image/jpeg',
            blob,
            sourceFileName: row.sourceFileName,
            sourcePage: row.page.pageNumber,
            parseStatus: row.confidence >= HIGH_CONFIDENCE && row.parsed.warnings.length === 0 ? 'auto' : 'manual',
            parseConfidence: row.confidence || null,
            employerCnpj: row.parsed.employerCnpj,
            employerName: row.parsed.employerName,
            payrollCode: row.parsed.payrollCode,
            totals: {
              totalEarnings: row.parsed.totalEarnings,
              totalDeductions: row.parsed.totalDeductions,
              netPay: row.parsed.netPay,
              baseSalary: row.parsed.baseSalary,
              baseInss: row.parsed.baseInss,
              baseFgts: row.parsed.baseFgts,
              fgtsMonth: row.parsed.fgtsMonth,
              baseIrrf: row.parsed.baseIrrf,
              irrfBracket: row.parsed.irrfBracket,
            },
            lines: row.parsed.lines,
          },
          user?.id ?? null,
        );

        updateRow(row.key, { status: 'saved' });
      } catch (err) {
        updateRow(row.key, { status: 'error', errorMessage: sanitizeError(err) });
      }
    }

    setIsSaving(false);
  }

  if (loadingRefs) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!currentGroup?.id) {
    return (
      <EmptyNotice
        icon={Building2}
        title="Grupo não identificado"
        message="Não foi possível resolver o grupo hoteleiro da sua conta. Recarregue a página ou fale com o administrador."
      />
    );
  }

  if (types.length === 0) {
    return (
      <EmptyNotice
        icon={Settings}
        title="Nenhum tipo de documento cadastrado"
        message="Cadastre pelo menos um tipo (por exemplo, Contracheque) na aba Tipos antes de enviar arquivos."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Configuração do envio */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
              Tipo de documento
            </label>
            <select
              value={docTypeId}
              onChange={e => setDocTypeId(e.target.value)}
              disabled={rows.length > 0}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white disabled:opacity-60"
            >
              {types.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.requires_signature ? ' (exige assinatura)' : ''}
                </option>
              ))}
            </select>
            {rows.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                Limpe a lista para trocar o tipo.
              </p>
            )}
          </div>

          <div className="flex items-end">
            <div className="w-full">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,image/*"
                onChange={e => handleFiles(e.target.files)}
                disabled={reading || isSaving}
                className="hidden"
                id="dp-docs-file-input"
              />
              <label
                htmlFor="dp-docs-file-input"
                className={`flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm cursor-pointer ${
                  reading || isSaving
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {reading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {readProgress || 'Lendo...'}</>
                  : <><Upload className="h-4 w-4" /> Escolher arquivos</>}
              </label>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          PDF ou imagem. Pode ser um arquivo por colaborador ou o lote inteiro num arquivo só —
          cada página vira uma linha de conferência. A busca do colaborador cobre todas as unidades
          do grupo, então contracheque emitido no CNPJ de outra unidade também encontra a pessoa.
        </p>
      </div>

      {error && <ErrorBox message={error} />}

      {/* Conciliação */}
      {rows.length > 0 && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="neutral">{rows.length} página(s)</Chip>
              <Chip tone="ok">{rows.filter(r => r.status === 'saved').length} gravada(s)</Chip>
              <Chip tone="warn">{unmatched.length} sem colaborador</Chip>
              {rows.some(r => r.status === 'error') && (
                <Chip tone="error">{rows.filter(r => r.status === 'error').length} com erro</Chip>
              )}

              <div className="flex-1" />

              <button
                onClick={() => setRows([])}
                disabled={isSaving}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                Limpar lista
              </button>
              <button
                onClick={handleSaveAll}
                disabled={isSaving || toSave.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-sm disabled:opacity-50"
              >
                {isSaving
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Gravando...</>
                  : <>Gravar {toSave.length} documento(s)</>}
              </button>
            </div>

            {highConfidence.length > 0 && (
              <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">
                {highConfidence.length} página(s) casaram com alta confiança (matrícula, CPF ou nome
                idêntico). As demais pedem conferência.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {rows.map(row => (
              <ReviewCard
                key={row.key}
                row={row}
                employees={employees}
                employee={row.employeeId ? employeeById.get(row.employeeId) ?? null : null}
                disabled={isSaving}
                onChangeEmployee={id => updateRow(row.key, {
                  employeeId: id,
                  // Escolha manual é decisão humana: some a marca de incerteza.
                  confidence: id ? 1 : 0,
                  ambiguous: false,
                  reason: id ? 'none' : 'none',
                })}
                onToggleSkip={() => updateRow(row.key, { skipped: !row.skipped })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Card de conciliação ──────────────────────────────────────────────────────

function ReviewCard({
  row, employees, employee, disabled, onChangeEmployee, onToggleSkip,
}: {
  row: ReviewRow;
  employees: GroupEmployee[];
  employee: GroupEmployee | null;
  disabled: boolean;
  onChangeEmployee: (id: string | null) => void;
  onToggleSkip: () => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return employees.slice(0, 40);
    return employees
      .filter(e => searchMatchAll(search, e.name, e.cpf, e.payroll_code, e.sector, e.hotel_name))
      .slice(0, 40);
  }, [search, employees]);

  // O CNPJ do arquivo diverge da unidade de cadastro? É o cenário normal do
  // grupo, então aparece como informação e não bloqueia nada.
  const differentUnit = Boolean(
    employee && row.parsed.employerName &&
    employee.hotel_name &&
    !row.parsed.employerName.toLowerCase().includes(employee.hotel_name.toLowerCase()),
  );

  const saved = row.status === 'saved';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl border shadow-sm overflow-hidden ${
      row.skipped
        ? 'border-gray-200 dark:border-gray-700 opacity-50'
        : saved
          ? 'border-emerald-300 dark:border-emerald-800'
          : row.status === 'error'
            ? 'border-rose-300 dark:border-rose-800'
            : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {/* Miniatura */}
        <div className="sm:w-40 shrink-0">
          {row.page.jpegDataUrl ? (
            <a href={row.page.jpegDataUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={row.page.jpegDataUrl}
                alt={`Página ${row.page.pageNumber} de ${row.sourceFileName}`}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
              />
            </a>
          ) : (
            <div className="w-full h-24 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-gray-400 truncate" title={row.sourceFileName}>
            {row.sourceFileName} · p.{row.page.pageNumber}
          </p>
        </div>

        {/* Dados lidos e escolha */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                {row.parsed.employeeName || 'Nome não lido'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {row.parsed.payrollCode ? `matrícula ${row.parsed.payrollCode}` : 'sem matrícula'}
                {' · '}
                {row.parsed.referenceMonth ? formatCompetence(row.parsed.referenceMonth) : 'sem competência'}
                {row.parsed.netPay !== null && ` · líquido ${formatCurrency(row.parsed.netPay)}`}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {saved && <Chip tone="ok">gravado</Chip>}
              {row.status === 'saving' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              {!saved && (
                <button
                  onClick={onToggleSkip}
                  disabled={disabled}
                  title={row.skipped ? 'Voltar a incluir' : 'Ignorar esta página'}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  {row.skipped ? <ChevronRight className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          {/* Confiança do casamento */}
          {!saved && (
            <div className="flex flex-wrap items-center gap-1.5">
              {row.employeeId ? (
                <>
                  <Chip tone={row.ambiguous ? 'warn' : row.confidence >= HIGH_CONFIDENCE ? 'ok' : 'warn'}>
                    {matchLabel(row.reason, row.confidence)}
                  </Chip>
                  {row.ambiguous && <Chip tone="warn">mais de um candidato — confira</Chip>}
                </>
              ) : (
                <Chip tone="warn">colaborador não identificado</Chip>
              )}
              {differentUnit && (
                <Chip tone="neutral">
                  emitido por {row.parsed.employerName}
                </Chip>
              )}
            </div>
          )}

          {/* Avisos da leitura */}
          {!saved && row.parsed.warnings.length > 0 && (
            <ul className="space-y-1">
              {row.parsed.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {row.status === 'error' && row.errorMessage && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{row.errorMessage}</p>
          )}

          {/* Seleção do colaborador */}
          {!saved && !row.skipped && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Colaborador
              </label>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar por nome, CPF, matrícula ou unidade"
                    disabled={disabled}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <select
                value={row.employeeId || ''}
                onChange={e => onChangeEmployee(e.target.value || null)}
                disabled={disabled}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              >
                <option value="">— não atribuir —</option>
                {/* O casado fica sempre na lista, mesmo que a busca o exclua */}
                {employee && !filtered.some(f => f.id === employee.id) && (
                  <option value={employee.id}>{employeeLabel(employee)}</option>
                )}
                {filtered.map(e => (
                  <option key={e.id} value={e.id}>{employeeLabel(e)}</option>
                ))}
              </select>
              {search.trim() && filtered.length === 40 && (
                <p className="mt-1 text-xs text-gray-400">
                  Mostrando os 40 primeiros — refine a busca.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function employeeLabel(e: GroupEmployee): string {
  const parts = [e.name];
  if (e.payroll_code) parts.push(`mat. ${e.payroll_code}`);
  if (e.hotel_name) parts.push(e.hotel_name);
  if (e.status && e.status !== 'active') parts.push(e.status === 'dismissed' ? 'desligado' : e.status);
  return parts.join(' · ');
}

function matchLabel(reason: MatchReason, confidence: number): string {
  const pct = Math.round(confidence * 100);
  switch (reason) {
    case 'payroll_code': return `casou pela matrícula (${pct}%)`;
    case 'cpf': return `casou pelo CPF (${pct}%)`;
    case 'exact_name': return `casou pelo nome (${pct}%)`;
    case 'name_terms': return `nome parecido (${pct}%) — confira`;
    default: return 'atribuído manualmente';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aba Painel — acompanhamento
// ═══════════════════════════════════════════════════════════════════════════

function PanelTab() {
  const { currentGroup } = useGroup();
  const { hotels } = useGroupHotels<{ id: string; name: string }>({ columns: 'id, name' });

  const [types, setTypes] = useState<EmployeeDocumentType[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [month, setMonth] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [docTypeId, setDocTypeId] = useState('');
  const [status, setStatus] = useState<'' | 'pending' | 'signed'>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, docs] = await Promise.all([
        listDocumentTypes(currentGroup?.id),
        listGroupDocuments(currentGroup?.id, {
          referenceMonth: month ? `${month}-01` : null,
          hotelId: hotelId || null,
          docTypeId: docTypeId || null,
          signatureStatus: status || null,
        }),
      ]);
      setTypes(t);
      setDocuments(docs);
    } catch (err) {
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [currentGroup?.id, month, hotelId, docTypeId, status]);

  useEffect(() => { load(); }, [load]);

  const pending = documents.filter(d => d.requires_signature && d.signature_status === 'pending').length;
  const signed = documents.filter(d => d.signature_status === 'signed').length;

  const hotelNames = useMemo(() => new Map(hotels.map(h => [h.id, h.name])), [hotels]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Competência">
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            />
          </Field>
          <Field label="Unidade de cadastro">
            <select
              value={hotelId}
              onChange={e => setHotelId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Todas do grupo</option>
              {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label="Tipo">
            <select
              value={docTypeId}
              onChange={e => setDocTypeId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Todos</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Assinatura">
            <select
              value={status}
              onChange={e => setStatus(e.target.value as any)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Todas</option>
              <option value="pending">Pendente</option>
              <option value="signed">Assinada</option>
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <Chip tone="neutral">{documents.length} documento(s)</Chip>
          <Chip tone="ok">{signed} assinado(s)</Chip>
          <Chip tone="warn">{pending} pendente(s)</Chip>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : documents.length === 0 ? (
        <EmptyNotice
          icon={FileText}
          title="Nenhum documento no filtro"
          message="Ajuste a competência ou envie os arquivos na aba Enviar."
        />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Colaborador</th>
                  <th className="text-left px-4 py-3">Unidade</th>
                  <th className="text-left px-4 py-3">Competência</th>
                  <th className="text-right px-4 py-3">Líquido</th>
                  <th className="text-left px-4 py-3">Assinatura</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">
                      {d.employees?.name || '—'}
                      {d.employees?.sector && (
                        <span className="block text-xs font-normal text-gray-400">{d.employees.sector}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {hotelNames.get(d.hotel_id || '') || '—'}
                      {d.employer_name && (
                        <span className="block text-gray-400">arquivo: {d.employer_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 tabular-nums">
                      {formatCompetence(d.reference_month)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-white">
                      {d.net_pay !== null ? formatCurrency(d.net_pay) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {!d.requires_signature ? (
                        <span className="text-xs text-gray-400">não exigida</span>
                      ) : d.signature_status === 'signed' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {d.signed_at ? new Date(d.signed_at).toLocaleDateString('pt-BR') : 'assinado'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          <PenLine className="h-3.5 w-3.5" /> pendente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-700">
            Para abrir, baixar ou excluir um documento, entre na ficha do colaborador, aba Documentos.
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Peças de UI
// ═══════════════════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'neutral'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${tones[tone]}`}>{children}</span>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3.5">
      <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
      <p className="text-sm text-rose-700 dark:text-rose-300">{message}</p>
    </div>
  );
}

function EmptyNotice({ icon: Icon, title, message }: { icon: any; title: string; message: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center shadow-sm">
      <Icon className="h-10 w-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-1">{title}</h3>
      <p className="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto">{message}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function unreadableRow(fileName: string, message: string): ReviewRow {
  return {
    key: `${fileName}#erro-${Date.now()}`,
    sourceFileName: fileName,
    page: { pageNumber: 1, jpegDataUrl: '', text: '', lines: [], width: 0, height: 0 },
    parsed: emptyParsed(message),
    employeeId: null,
    confidence: 0,
    reason: 'none',
    ambiguous: false,
    skipped: true,
    status: 'error',
    errorMessage: message,
  };
}

function emptyParsed(warning: string): ParsedPayslip {
  return {
    employerName: null, employerCnpj: null,
    payrollCode: null, employeeName: null, employeeCpf: null,
    periodStart: null, periodEnd: null, referenceMonth: null,
    lines: [],
    totalEarnings: null, totalDeductions: null, netPay: null,
    baseSalary: null, baseInss: null, baseFgts: null,
    fgtsMonth: null, baseIrrf: null, irrfBracket: null,
    warnings: [warning],
  };
}

function formatCompetence(reference: string | null): string {
  if (!reference) return '—';
  const [year, month] = reference.split('-');
  return `${month}/${year}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
