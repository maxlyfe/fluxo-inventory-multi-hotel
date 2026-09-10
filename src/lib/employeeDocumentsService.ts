// src/lib/employeeDocumentsService.ts
//
// Acesso a dados dos documentos do colaborador (contracheque e afins).
//
// Três regras que o resto do módulo herda daqui e não deve repetir na mão:
//
// 1. **Escopo é o GRUPO, não a unidade selecionada.** O contracheque pode ser
//    emitido no CNPJ de uma unidade e a pessoa estar cadastrada em outra. Toda
//    listagem passa por `listGroupHotels`, que falha fechada (sem grupo, lista
//    vazia) — ver src/lib/hotelsService.ts.
//
// 2. **O arquivo nunca tem URL pública.** O bucket `employee-documents` é
//    privado; leitura é sempre `createSignedUrl` com TTL curto. Copiar o padrão
//    `getPublicUrl` dos outros buckets do projeto aqui significaria publicar a
//    folha de pagamento para quem tivesse o link.
//
// 3. **A linha vem antes do arquivo.** A policy de INSERT do storage confere o
//    dono do caminho consultando `employee_documents`, então a linha precisa
//    existir antes do upload. `createDocumentWithFile` faz nessa ordem e limpa
//    a linha se o upload falhar.

import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows';
import { listGroupHotels } from './hotelsService';
import type { MatchableEmployee, PayslipLine } from './payslipParser';

export const EMPLOYEE_DOCS_BUCKET = 'employee-documents';

/** TTL da URL assinada. Curto de propósito: o link não deve virar arquivo. */
const SIGNED_URL_TTL_SECONDS = 120;

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface EmployeeDocumentType {
  id: string;
  group_id: string | null;
  name: string;
  slug: string;
  requires_signature: boolean;
  visible_in_portal: boolean;
  is_payslip: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  doc_type_id: string;
  hotel_id: string | null;
  group_id: string | null;
  reference_month: string | null;
  period_start: string | null;
  period_end: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  original_sha256: string | null;
  source_file_name: string | null;
  source_page: number | null;
  parse_status: 'auto' | 'manual';
  parse_confidence: number | null;
  employer_cnpj: string | null;
  employer_name: string | null;
  payroll_code: string | null;
  total_earnings: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  base_salary: number | null;
  base_inss: number | null;
  base_fgts: number | null;
  fgts_month: number | null;
  base_irrf: number | null;
  irrf_bracket: string | null;
  requires_signature: boolean;
  signature_status: 'pending' | 'signed';
  signature_data: string | null;
  signed_at: string | null;
  signed_file_path: string | null;
  /**
   * Onde estampar a rubrica no proprio documento, 0 a 1 da pagina (origem no
   * canto superior esquerdo). Descoberto na leitura do arquivo e guardado
   * porque, na hora de assinar, so existe o JPEG da pagina — sem camada de
   * texto para consultar de novo.
   */
  signature_anchor_x: number | null;
  signature_anchor_y: number | null;
  date_anchor_x: number | null;
  date_anchor_y: number | null;
  /**
   * Registro de visualizacao. Separa dois estados que antes eram um so
   * "pendente": nao viu (cobrar que abra) e viu e nao assinou (cobrar a
   * assinatura). Nao substitui a assinatura.
   */
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  created_at: string;
  /** Vem do join quando pedido */
  employee_document_types?: { name: string; slug: string } | null;
  employees?: { name: string; sector: string | null; hotel_id: string | null } | null;
}

/** Uma sessao de visualizacao do documento pelo colaborador. */
export interface DocumentView {
  id: string;
  viewed_at: string;
  /** User agent cru; use `describeDevice` para exibir. */
  user_agent: string | null;
  source: 'portal' | 'download' | 'signature';
}

export interface DocumentLine {
  id: string;
  code: string | null;
  description: string;
  reference: string | null;
  earning: number | null;
  deduction: number | null;
  sort_order: number;
}

/** Colaborador do grupo, com a unidade resolvida para exibição. */
export interface GroupEmployee extends MatchableEmployee {
  id: string;
  name: string;
  cpf: string | null;
  payroll_code: string | null;
  hotel_id: string | null;
  sector: string | null;
  role: string | null;
  status: string | null;
  /** Conta de sistema vinculada. Sem ela nao ha como notificar nem assinar. */
  user_id: string | null;
  hotel_name?: string;
}

/** Colunas lidas na listagem. Explícitas para não trazer o resto da ficha. */
const DOCUMENT_COLUMNS = `
  id, employee_id, doc_type_id, hotel_id, group_id,
  reference_month, period_start, period_end,
  file_path, file_name, file_size, content_type, original_sha256,
  source_file_name, source_page, parse_status, parse_confidence,
  employer_cnpj, employer_name, payroll_code,
  total_earnings, total_deductions, net_pay,
  base_salary, base_inss, base_fgts, fgts_month, base_irrf, irrf_bracket,
  requires_signature, signature_status, signature_data, signed_at, signed_file_path,
  signature_anchor_x, signature_anchor_y, date_anchor_x, date_anchor_y,
  first_viewed_at, last_viewed_at, view_count,
  created_at
`;

// ── Tipos de documento ───────────────────────────────────────────────────────

export async function listDocumentTypes(
  groupId: string | null | undefined,
  options: { includeInactive?: boolean } = {},
): Promise<EmployeeDocumentType[]> {
  if (!groupId) return [];

  let query = supabase
    .from('employee_document_types')
    .select('*')
    .eq('group_id', groupId)
    .order('sort_order')
    .order('name');

  if (!options.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as EmployeeDocumentType[];
}

export async function saveDocumentType(
  groupId: string,
  type: Partial<EmployeeDocumentType> & { name: string },
): Promise<EmployeeDocumentType> {
  const payload = {
    group_id: groupId,
    name: type.name.trim(),
    slug: type.slug?.trim() || slugify(type.name),
    requires_signature: type.requires_signature ?? true,
    visible_in_portal: type.visible_in_portal ?? true,
    is_payslip: type.is_payslip ?? false,
    is_active: type.is_active ?? true,
    sort_order: type.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  };

  const query = type.id
    ? supabase.from('employee_document_types').update(payload).eq('id', type.id)
    : supabase.from('employee_document_types').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data as EmployeeDocumentType;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Colaboradores do grupo ───────────────────────────────────────────────────

/**
 * Todos os colaboradores das unidades do grupo, para casamento e atribuição.
 *
 * Inclui desligados: contracheque de rescisão chega depois do desligamento, e
 * sem eles a conciliação daria "não encontrado" justamente nesse caso.
 *
 * Paginado com `fetchAllRows` porque a rede passa das 1000 linhas do teto do
 * PostgREST, que corta a resposta sem erro nem aviso.
 */
export async function listGroupEmployees(groupId: string | null | undefined): Promise<GroupEmployee[]> {
  if (!groupId) return [];

  const hotels = await listGroupHotels<{ id: string; name: string }>(groupId, {
    columns: 'id, name',
    includeInactive: true, // documento de unidade arquivada continua existindo
  });
  if (hotels.length === 0) return [];

  const hotelNames = new Map(hotels.map(h => [h.id, h.name]));
  const hotelIds = hotels.map(h => h.id);

  const rows = await fetchAllRows<GroupEmployee>((from, to) =>
    supabase
      .from('employees')
      .select('id, name, cpf, payroll_code, hotel_id, sector, role, status, user_id')
      .in('hotel_id', hotelIds)
      .neq('status', 'deleted')
      .order('name')
      .order('id') // segundo critério: paginação estável
      .range(from, to),
  );

  return rows.map(r => ({ ...r, hotel_name: hotelNames.get(r.hotel_id || '') }));
}

// ── Leitura de documentos ────────────────────────────────────────────────────

export async function listEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select(`${DOCUMENT_COLUMNS}, employee_document_types(name, slug)`)
    .eq('employee_id', employeeId)
    .order('reference_month', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as EmployeeDocument[];
}

export interface GroupDocumentFilters {
  referenceMonth?: string | null;
  hotelId?: string | null;
  docTypeId?: string | null;
  signatureStatus?: 'pending' | 'signed' | null;
}

/**
 * Documentos do grupo, para o painel do DP.
 *
 * O recorte por grupo é feito pelas unidades, e não confiando na RLS: mesmo
 * motivo de `listGroupHotels` existir — o perfil dev tem passe livre no banco.
 */
export async function listGroupDocuments(
  groupId: string | null | undefined,
  filters: GroupDocumentFilters = {},
): Promise<EmployeeDocument[]> {
  if (!groupId) return [];

  const hotels = await listGroupHotels<{ id: string }>(groupId, {
    columns: 'id',
    includeInactive: true,
  });
  if (hotels.length === 0) return [];

  const hotelIds = filters.hotelId ? [filters.hotelId] : hotels.map(h => h.id);
  // Unidade fora do grupo no filtro não deve abrir nada.
  if (filters.hotelId && !hotels.some(h => h.id === filters.hotelId)) return [];

  return fetchAllRows<EmployeeDocument>((from, to) => {
    let query = supabase
      .from('employee_documents')
      .select(`${DOCUMENT_COLUMNS}, employee_document_types(name, slug), employees(name, sector, hotel_id)`)
      .in('hotel_id', hotelIds);

    if (filters.referenceMonth) query = query.eq('reference_month', filters.referenceMonth);
    if (filters.docTypeId) query = query.eq('doc_type_id', filters.docTypeId);
    if (filters.signatureStatus) query = query.eq('signature_status', filters.signatureStatus);

    return query
      .order('reference_month', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to) as any;
  });
}

export async function listDocumentLines(documentId: string): Promise<DocumentLine[]> {
  const { data, error } = await supabase
    .from('employee_document_lines')
    .select('id, code, description, reference, earning, deduction, sort_order')
    .eq('document_id', documentId)
    .order('sort_order');

  if (error) throw error;
  return (data || []) as DocumentLine[];
}

/**
 * Documentos do colaborador logado, resolvidos SEM filtro de unidade.
 *
 * É o ponto do módulo que corrige o problema de `MyDocuments.tsx`, que casa
 * `user_id` junto com `hotel_id = selectedHotel`: quem está cadastrado na
 * unidade D mas com a unidade C selecionada vê "conta não vinculada". Para
 * contracheque isso seria pior que um estado vazio — pareceria que a empresa
 * não pagou.
 */
export async function resolveMyEmployee(userId: string): Promise<GroupEmployee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, cpf, payroll_code, hotel_id, sector, role, status, user_id')
    .eq('user_id', userId)
    .neq('status', 'deleted')
    // Um usuário pode ter vínculo em mais de uma unidade ao longo do tempo; o
    // ativo é o que vale, e o mais recente desempata.
    .order('status')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0] as GroupEmployee) ?? null;
}

/**
 * Avisa o colaborador dos documentos que ja o esperavam quando a conta foi
 * vinculada.
 *
 * Existe por causa de uma assimetria do modulo: o documento e gravado contra
 * `employees.id`, entao subir contracheque de quem ainda nao tem conta funciona
 * e o arquivo fica guardado na ficha. O acesso tambem se resolve sozinho, porque
 * a RLS avalia `employees.user_id = auth.uid()` no momento da consulta — vincular
 * a conta libera todo o retroativo de uma vez, sem migrar nada.
 *
 * O que NAO se resolve sozinho e o aviso: a notificacao de "contracheque
 * disponivel" e disparada no envio do lote, e naquele momento nao havia
 * destinatario. Sem esta chamada, a pessoa passa a ter N documentos pendentes e
 * nenhuma notificacao dizendo isso.
 *
 * Manda UMA notificacao com o total, nao uma por documento: um ano de folha
 * retroativa viraria doze pushes seguidos, que e como se ensina o usuario a
 * ignorar notificacao.
 *
 * Melhor esforco: devolve quantos documentos motivaram o aviso, e nunca lanca —
 * falhar aqui nao pode desfazer o vinculo, que e a operacao principal.
 */
export async function notifyPendingDocumentsAfterLink(
  employeeId: string,
  userId: string,
  options: { hotelId?: string | null } = {},
): Promise<number> {
  try {
    const pending = await countPendingSignature(employeeId);
    if (pending === 0) return 0;

    // Import tardio: `notifications.ts` puxa `workHours`, que puxa outras
    // partes do app. Carregar isso no caminho de leitura de documentos seria
    // peso morto em toda tela do modulo.
    const { createNotification } = await import('./notifications');

    await createNotification({
      user_id: userId,
      title: pending === 1 ? 'Contracheque disponível' : 'Contracheques disponíveis',
      message: pending === 1
        ? 'Você tem 1 contracheque disponível para assinatura'
        : `Você tem ${pending} contracheques disponíveis para assinatura`,
      event_key: 'EMPLOYEE_DOCUMENT_PENDING_SIGNATURE',
      target_path: '/portal/my-payslips',
      hotel_id: options.hotelId ?? null,
      related_entity_type: 'employee_document',
    });

    return pending;
  } catch {
    return 0;
  }
}

/**
 * Registra que o colaborador abriu o documento.
 *
 * Passa por RPC pelo mesmo motivo da assinatura: `employee_documents` nao tem
 * policy de UPDATE, e `employee_document_views` nao tem policy de INSERT. Se o
 * cliente pudesse gravar direto, "o colaborador viu" viraria um fato que
 * qualquer um forja — e o valor dele e justamente ser um fato do servidor.
 *
 * A RPC deduplica numa janela de 30 minutos, entao chamar a cada abertura de
 * modal e barato e nao polui o historico.
 *
 * Melhor esforco e nunca lanca: falhar ao registrar a visualizacao nao pode
 * impedir o colaborador de VER ou de assinar o proprio contracheque.
 */
export async function registerDocumentView(
  documentId: string,
  source: 'portal' | 'download' | 'signature' = 'portal',
): Promise<void> {
  try {
    await supabase.rpc('register_employee_document_view', {
      p_document_id: documentId,
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : null,
      p_source: source,
    });
  } catch {
    // Silencioso de proposito — ver comentario acima.
  }
}

/** Historico de visualizacoes de um documento, do mais recente para o antigo. */
export async function listDocumentViews(documentId: string): Promise<DocumentView[]> {
  const { data, error } = await supabase
    .from('employee_document_views')
    .select('id, viewed_at, user_agent, source')
    .eq('document_id', documentId)
    .order('viewed_at', { ascending: false });

  if (error) throw error;
  return (data || []) as DocumentView[];
}

/** Quantos documentos do colaborador aguardam assinatura (para o widget). */
export async function countPendingSignature(employeeId: string): Promise<number> {
  const { count, error } = await supabase
    .from('employee_documents')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('requires_signature', true)
    .eq('signature_status', 'pending');

  if (error) throw error;
  return count ?? 0;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * URL temporária para abrir ou baixar o arquivo.
 *
 * Sempre assinada: o bucket é privado. Não guarde o retorno em banco nem em
 * link compartilhável — ele expira e, enquanto vive, dispensa autenticação.
 */
export async function getSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(EMPLOYEE_DOCS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  return data?.signedUrl ?? null;
}

/** `data:...;base64,xxx` ou base64 puro para Blob, sem passar por fetch(). */
export function base64ToBlob(base64: string, contentType: string): Blob {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/**
 * SHA-256 do conteúdo, citado no PDF assinado como âncora de integridade.
 *
 * Serve para provar depois que o documento assinado corresponde ao arquivo
 * arquivado — sem isso, "assinado" só significaria "alguém desenhou algo".
 */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (!crypto?.subtle) return null; // contexto não seguro: segue sem o hash
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Nome de arquivo seguro para caminho de storage. */
function safeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .slice(-120);
}

// ── Escrita ──────────────────────────────────────────────────────────────────

export interface NewDocumentInput {
  employeeId: string;
  hotelId: string | null;
  groupId: string;
  docTypeId: string;
  requiresSignature: boolean;
  referenceMonth: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  fileName: string;
  contentType: string;
  blob: Blob;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  parseStatus: 'auto' | 'manual';
  parseConfidence?: number | null;
  employerCnpj?: string | null;
  employerName?: string | null;
  payrollCode?: string | null;
  totals?: {
    totalEarnings?: number | null;
    totalDeductions?: number | null;
    netPay?: number | null;
    baseSalary?: number | null;
    baseInss?: number | null;
    baseFgts?: number | null;
    fgtsMonth?: number | null;
    baseIrrf?: number | null;
    irrfBracket?: string | null;
  };
  lines?: PayslipLine[];
  /** Posicao da linha de assinatura no documento (normalizada 0..1). */
  signatureAnchor?: {
    signatureCenterX: number;
    signatureBaselineY: number;
    dateCenterX: number | null;
    dateBaselineY: number | null;
  } | null;
}

/**
 * Cria o documento, sobe o arquivo e grava as verbas.
 *
 * A ordem é imposta pela policy de INSERT do storage, que confere o dono do
 * caminho olhando `employee_documents`: a linha tem que existir antes do
 * upload. Como o caminho contém o id do documento, o uuid é gerado no cliente
 * (`crypto.randomUUID`) em vez de deixado para o `DEFAULT` do banco — assim o
 * `file_path` já vai definitivo no próprio insert, sem um segundo UPDATE.
 *
 * Se o upload falhar, a linha é removida — documento sem arquivo é pior que
 * documento nenhum, porque aparece na lista do colaborador e não abre.
 */
export async function createDocumentWithFile(
  input: NewDocumentInput,
  userId: string | null,
): Promise<EmployeeDocument> {
  const documentId = crypto.randomUUID();
  const fileName = safeFileName(input.fileName);
  const filePath = `${input.groupId}/${input.employeeId}/${documentId}/${fileName}`;
  const hash = await sha256Hex(input.blob);

  const { data: created, error: insertError } = await supabase
    .from('employee_documents')
    .insert({
      id: documentId,
      employee_id: input.employeeId,
      doc_type_id: input.docTypeId,
      hotel_id: input.hotelId,
      group_id: input.groupId,
      reference_month: input.referenceMonth,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      file_path: filePath,
      file_name: input.fileName,
      file_size: input.blob.size,
      content_type: input.contentType,
      original_sha256: hash,
      source_file_name: input.sourceFileName ?? null,
      source_page: input.sourcePage ?? null,
      parse_status: input.parseStatus,
      parse_confidence: input.parseConfidence ?? null,
      employer_cnpj: input.employerCnpj ?? null,
      employer_name: input.employerName ?? null,
      payroll_code: input.payrollCode ?? null,
      total_earnings: input.totals?.totalEarnings ?? null,
      total_deductions: input.totals?.totalDeductions ?? null,
      net_pay: input.totals?.netPay ?? null,
      base_salary: input.totals?.baseSalary ?? null,
      base_inss: input.totals?.baseInss ?? null,
      base_fgts: input.totals?.baseFgts ?? null,
      fgts_month: input.totals?.fgtsMonth ?? null,
      base_irrf: input.totals?.baseIrrf ?? null,
      irrf_bracket: input.totals?.irrfBracket ?? null,
      requires_signature: input.requiresSignature,
      signature_anchor_x: input.signatureAnchor?.signatureCenterX ?? null,
      signature_anchor_y: input.signatureAnchor?.signatureBaselineY ?? null,
      date_anchor_x: input.signatureAnchor?.dateCenterX ?? null,
      date_anchor_y: input.signatureAnchor?.dateBaselineY ?? null,
      uploaded_by: userId,
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (insertError) throw insertError;

  try {
    const { error: uploadError } = await supabase.storage
      .from(EMPLOYEE_DOCS_BUCKET)
      .upload(filePath, input.blob, { contentType: input.contentType, upsert: true });
    if (uploadError) throw uploadError;

    if (input.lines && input.lines.length > 0) {
      const { error: linesError } = await supabase.from('employee_document_lines').insert(
        input.lines.map((l, index) => ({
          document_id: documentId,
          code: l.code,
          description: l.description,
          reference: l.reference,
          earning: l.earning,
          deduction: l.deduction,
          sort_order: index,
        })),
      );
      if (linesError) throw linesError;
    }
  } catch (err) {
    // Rollback manual: sem transação entre Postgres e Storage, a limpeza é
    // nossa. O arquivo sai também, para não deixar órfão pagando storage.
    await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([filePath]).catch(() => {});
    await supabase.from('employee_documents').delete().eq('id', documentId);
    throw err;
  }

  return created as unknown as EmployeeDocument;
}

/**
 * Registra a assinatura do colaborador.
 *
 * Passa pela RPC porque `employee_documents` não tem policy de UPDATE: o dono
 * do documento é resolvido no banco a partir de `auth.uid()`, e a função é
 * idempotente (reassinar devolve o que já estava lá em vez de sobrescrever).
 */
export async function signDocument(params: {
  documentId: string;
  signatureDataUrl: string;
  signedFilePath?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('sign_employee_document', {
    p_document_id: params.documentId,
    p_signature: params.signatureDataUrl,
    p_signed_file_path: params.signedFilePath ?? null,
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : null,
  });
  if (error) throw error;
}

/** Sobe o PDF assinado gerado no cliente e devolve o caminho no bucket. */
export async function uploadSignedPdf(params: {
  document: EmployeeDocument;
  pdfBlob: Blob;
}): Promise<string> {
  const { document: doc, pdfBlob } = params;
  const base = doc.file_name.replace(/\.[^.]+$/, '');
  const path = `${doc.group_id}/${doc.employee_id}/${doc.id}/${safeFileName(`${base}-assinado.pdf`)}`;

  // A policy do storage confere o caminho contra `signed_file_path`, que só é
  // preenchido pela RPC. Por isso o upload vem DEPOIS da assinatura, e a
  // gravação do caminho acontece na mesma chamada da RPC.
  const { error } = await supabase.storage
    .from(EMPLOYEE_DOCS_BUCKET)
    .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: true });

  if (error) throw error;
  return path;
}

/** Caminho previsível do PDF assinado, para gravar na RPC antes do upload. */
export function signedPdfPath(doc: EmployeeDocument): string {
  const base = doc.file_name.replace(/\.[^.]+$/, '');
  return `${doc.group_id}/${doc.employee_id}/${doc.id}/${safeFileName(`${base}-assinado.pdf`)}`;
}

/**
 * Exclui o documento, o arquivo original e o comprovante assinado.
 *
 * Storage primeiro: se a linha saísse antes, a policy de DELETE do storage
 * continuaria valendo (ela só exige a permissão), mas ficaríamos sem o caminho
 * para apagar — arquivo órfão e invisível.
 */
export async function deleteDocument(doc: EmployeeDocument): Promise<void> {
  const paths = [doc.file_path, doc.signed_file_path].filter(Boolean) as string[];
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove(paths);
    if (error) throw error;
  }

  // As verbas saem por ON DELETE CASCADE.
  const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id);
  if (error) throw error;
}
