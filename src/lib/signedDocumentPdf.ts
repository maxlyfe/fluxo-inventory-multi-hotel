// src/lib/signedDocumentPdf.ts
//
// Monta o PDF do documento assinado: as páginas originais mais um bloco de
// assinatura no fim.
//
// Usa jsPDF, que já era dependência do projeto e não tinha nenhum consumidor em
// `src/`. O outro caminho disponível seria html2canvas (`orderImage.ts`), mas
// ele produz IMAGEM: um comprovante de recebimento de salário precisa ser um
// arquivo que o colaborador consiga guardar, imprimir e apresentar fora do
// sistema, e para isso PDF é o formato que a contabilidade e a Justiça do
// Trabalho esperam.
//
// O original nunca é sobrescrito: isto gera um segundo arquivo, ao lado.

import type { EmployeeDocument } from './employeeDocumentsService';

/** Texto de validade da assinatura eletrônica, no mesmo teor já usado no
 *  aceite do web check-in (`WCICompanionEntry`), citando as normas que dão
 *  eficácia à assinatura eletrônica simples. */
const VALIDITY_NOTICE =
  'Declaração de recebimento assinada eletronicamente. A assinatura eletrônica aqui '
  + 'coletada tem validade jurídica nos termos do art. 10, §2º da MP 2.200-2/2001 e do '
  + 'Marco Civil da Internet (Lei 12.965/2014), por acordo entre as partes. A integridade '
  + 'do documento original é verificável pelo resumo criptográfico (SHA-256) abaixo.';

export interface SignedPdfInput {
  /** Páginas do documento original, na ordem (`data:image/jpeg;base64,...`). */
  pageImages: string[];
  document: EmployeeDocument;
  employee: { name: string; cpf?: string | null; payroll_code?: string | null; sector?: string | null };
  /** PNG da rubrica (`data:image/png;base64,...`). */
  signatureDataUrl: string;
  signedAt: Date;
  /** Rótulo do tipo de documento, ex. "Contracheque". */
  docTypeLabel: string;
}

// A4 em milímetros, que é a unidade do jsPDF aqui.
const A4_WIDTH = 210;
const A4_HEIGHT = 297;
const MARGIN = 12;

/**
 * Gera o PDF assinado.
 *
 * Dinâmico no import para não somar o jsPDF ao bundle inicial — o projeto já
 * carrega 5,68 MB num chunk único, e isso só é usado quando alguém assina.
 */
export async function buildSignedPdf(input: SignedPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const usableWidth = A4_WIDTH - MARGIN * 2;

  // ── Páginas do documento original ─────────────────────────────────────────
  for (let i = 0; i < input.pageImages.length; i++) {
    if (i > 0) pdf.addPage();
    const dims = await imageDimensions(input.pageImages[i]);
    const scale = Math.min(usableWidth / dims.width, (A4_HEIGHT - MARGIN * 2) / dims.height);
    const width = dims.width * scale;
    const height = dims.height * scale;
    // Centralizado na horizontal; encostado no topo, para o bloco de
    // assinatura caber embaixo quando a página é baixa (o caso do
    // contracheque, que ocupa pouco mais de meia folha).
    pdf.addImage(input.pageImages[i], 'JPEG', (A4_WIDTH - width) / 2, MARGIN, width, height);
  }

  if (input.pageImages.length === 0) pdf.text('Documento sem imagem disponível.', MARGIN, MARGIN + 6);

  // ── Bloco de assinatura ───────────────────────────────────────────────────
  // Em página nova sempre: caber ou não na sobra da última página depende do
  // tamanho do documento, e um bloco cortado ao meio não serve de comprovante.
  pdf.addPage();
  let y = MARGIN + 4;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text('Comprovante de Recebimento', MARGIN, y);
  y += 8;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);

  const rows: [string, string][] = [
    ['Documento', input.docTypeLabel],
    ['Competência', formatCompetence(input.document.reference_month)],
    ['Colaborador', input.employee.name],
    ['CPF', input.employee.cpf || 'não informado'],
    ['Matrícula', input.employee.payroll_code || input.document.payroll_code || 'não informada'],
    ['Setor', input.employee.sector || 'não informado'],
    ['Empregador no documento', input.document.employer_name || 'não identificado'],
    ['CNPJ no documento', input.document.employer_cnpj || 'não identificado'],
    ['Valor líquido', formatCurrency(input.document.net_pay)],
    ['Assinado em', input.signedAt.toLocaleString('pt-BR')],
  ];

  for (const [label, value] of rows) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${label}:`, MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(value), MARGIN + 48, y);
    y += 5.6;
  }

  y += 4;

  // ── Rubrica ───────────────────────────────────────────────────────────────
  const sigDims = await imageDimensions(input.signatureDataUrl);
  const SIG_MAX_W = 70;
  const SIG_MAX_H = 26;
  const sigScale = Math.min(SIG_MAX_W / sigDims.width, SIG_MAX_H / sigDims.height, 1);
  const sigW = sigDims.width * sigScale;
  const sigH = sigDims.height * sigScale;

  pdf.addImage(input.signatureDataUrl, 'PNG', MARGIN, y, sigW, sigH);
  y += sigH + 2;

  pdf.setDrawColor(60);
  pdf.line(MARGIN, y, MARGIN + 90, y);
  y += 4.5;

  pdf.setFontSize(9);
  pdf.text(input.employee.name, MARGIN, y);
  y += 4.5;
  if (input.employee.cpf) {
    pdf.text(`CPF ${input.employee.cpf}`, MARGIN, y);
    y += 4.5;
  }

  y += 5;

  // ── Aviso de validade e hash ──────────────────────────────────────────────
  pdf.setFontSize(7.5);
  pdf.setTextColor(90);
  const notice = pdf.splitTextToSize(VALIDITY_NOTICE, usableWidth) as string[];
  pdf.text(notice, MARGIN, y);
  y += notice.length * 3.4 + 3;

  if (input.document.original_sha256) {
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7);
    const hash = pdf.splitTextToSize(
      `SHA-256 do documento original: ${input.document.original_sha256}`,
      usableWidth,
    ) as string[];
    pdf.text(hash, MARGIN, y);
  }

  return pdf.output('blob');
}

/** Largura e altura reais de uma imagem em dataURL. */
function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Imagem inválida ao montar o PDF assinado'));
    img.src = dataUrl;
  });
}

function formatCompetence(reference: string | null): string {
  if (!reference) return 'não informada';
  const [year, month] = reference.split('-');
  return `${month}/${year}`;
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return 'não informado';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
