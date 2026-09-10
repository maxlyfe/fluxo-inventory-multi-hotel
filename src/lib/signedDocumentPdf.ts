// src/lib/signedDocumentPdf.ts
//
// Monta o PDF do documento assinado.
//
// A rubrica é estampada **no próprio documento**, na linha "ASSINATURA DO
// FUNCIONÁRIO" que o contracheque já traz, e não numa folha adicional. Foi o
// primeiro desenho (página extra com o bloco de assinatura) e estava errado por
// um motivo prático: quem recebe o comprovante compara com o papel que sempre
// assinou, e um recibo cuja assinatura está em outra folha não se parece com um
// recibo assinado. A prova jurídica não muda de lugar — continua no mesmo
// arquivo, só que na linha que existe para isso.
//
// A posição vem de `employee_documents.signature_anchor_*`, descoberta na
// leitura do arquivo (`findSignatureAnchor`) e guardada porque na hora de
// assinar só existe o JPEG da página, sem camada de texto para consultar.
//
// Sem âncora (imagem, PDF escaneado ou layout desconhecido) a rubrica vai num
// bloco compacto **abaixo** do documento, na mesma página. Estampar às cegas
// numa posição fixa arriscaria cair sobre um valor.
//
// Usa jsPDF, que já era dependência do projeto. O outro caminho disponível
// (html2canvas, em `orderImage.ts`) produz IMAGEM, e um comprovante de
// recebimento de salário precisa ser um arquivo que o colaborador guarde,
// imprima e apresente fora do sistema.
//
// O original nunca é sobrescrito: isto gera um segundo arquivo, ao lado.

import type { EmployeeDocument } from './employeeDocumentsService';

/** Validade da assinatura eletrônica simples, no mesmo teor do aceite do WCI. */
const VALIDITY_NOTICE =
  'Assinado eletronicamente pelo colaborador no Portal LyFe. A assinatura eletrônica '
  + 'tem validade nos termos do art. 10, §2º da MP 2.200-2/2001 e da Lei 12.965/2014. '
  + 'A integridade do documento original é verificável pelo resumo SHA-256 abaixo.';

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
const MARGIN = 10;

/** Largura máxima da rubrica estampada, em fração da largura do documento. */
const STAMP_WIDTH_RATIO = 0.26;
/**
 * Altura da rubrica, em fração da altura do documento.
 *
 * O espaço útil é a distância entre o traço da assinatura e a borda inferior da
 * caixa do recibo. Medido no layout real: cabe pouco mais de 4%.
 */
const STAMP_HEIGHT_RATIO = 0.042;
/**
 * Quanto a base da rubrica sobe acima da linha de base do rótulo.
 *
 * O rótulo "ASSINATURA DO FUNCIONÁRIO" fica **abaixo** do traço, então a
 * rubrica precisa subir o suficiente para pousar sobre o traço em vez de
 * cobrir o texto do rótulo.
 */
const STAMP_LIFT_RATIO = 0.018;

/**
 * Gera o PDF assinado.
 *
 * Import dinâmico do jsPDF para não somar 415 kB ao bundle inicial — o projeto
 * já carrega um chunk único grande, e isso só roda quando alguém assina.
 */
export async function buildSignedPdf(input: SignedPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const usableWidth = A4_WIDTH - MARGIN * 2;

  // Proporção da rubrica, medida uma vez. 3:1 é o padrão de uma assinatura
  // manuscrita, e serve de reserva se a imagem não puder ser medida.
  const sigRatio = await aspectRatio(input.signatureDataUrl, 3);

  if (input.pageImages.length === 0) {
    // Sem imagem não há onde estampar; o comprovante ainda tem de existir.
    pdf.setFontSize(11);
    pdf.text('Documento sem imagem disponível.', MARGIN, MARGIN + 8);
    renderSignatureBlock(pdf, input, MARGIN + 16, usableWidth, sigRatio);
    return pdf.output('blob');
  }

  const anchor = resolveAnchor(input.document);

  for (let i = 0; i < input.pageImages.length; i++) {
    if (i > 0) pdf.addPage();

    const image = input.pageImages[i];
    const dims = await imageDimensions(image);
    const scale = Math.min(usableWidth / dims.width, (A4_HEIGHT - MARGIN * 2) / dims.height);

    const docWidth = dims.width * scale;
    const docHeight = dims.height * scale;
    const docLeft = (A4_WIDTH - docWidth) / 2;
    const docTop = MARGIN;

    pdf.addImage(image, 'JPEG', docLeft, docTop, docWidth, docHeight);

    // A rubrica vai só na ÚLTIMA página: é lá que o layout põe o recibo, e
    // estampar em todas duplicaria a assinatura num documento de duas folhas.
    const isLast = i === input.pageImages.length - 1;
    if (!isLast) continue;

    if (anchor) {
      stampOnDocument(pdf, input, anchor, { docLeft, docTop, docWidth, docHeight }, sigRatio);
    } else {
      // Sem âncora, o bloco vai logo abaixo do documento — mesma página.
      renderSignatureBlock(pdf, input, docTop + docHeight + 6, usableWidth, sigRatio);
    }
  }

  return pdf.output('blob');
}

interface Anchor {
  signatureCenterX: number;
  signatureBaselineY: number;
  dateCenterX: number | null;
  dateBaselineY: number | null;
}

/**
 * Âncora do banco, recusando valor fora da faixa.
 *
 * O CHECK do banco já barra isso na escrita, mas um documento gravado antes da
 * migration pode ter a coluna nula e um valor absurdo chegaria como `NaN` do
 * PostgREST. Recusar aqui cai no bloco ao pé da página, que é seguro.
 */
function resolveAnchor(doc: EmployeeDocument): Anchor | null {
  const x = doc.signature_anchor_x;
  const y = doc.signature_anchor_y;

  const valid = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

  if (!valid(x) || !valid(y)) return null;

  return {
    signatureCenterX: x,
    signatureBaselineY: y,
    dateCenterX: valid(doc.date_anchor_x) ? doc.date_anchor_x : null,
    dateBaselineY: valid(doc.date_anchor_y) ? doc.date_anchor_y : null,
  };
}

interface DocBox {
  docLeft: number;
  docTop: number;
  docWidth: number;
  docHeight: number;
}

/**
 * Estampa a rubrica (e a data) sobre a imagem do documento.
 *
 * As âncoras são frações do documento, então a conversão para milímetro usa a
 * caixa em que a imagem foi desenhada, não a página. É isso que faz a marca
 * cair no lugar certo mesmo com o documento centrado e escalado no A4.
 */
function stampOnDocument(
  pdf: any,
  input: SignedPdfInput,
  anchor: Anchor,
  box: DocBox,
  sigRatio: number,
) {
  const { docLeft, docTop, docWidth, docHeight } = box;

  // ── Rubrica ───────────────────────────────────────────────────────────────
  const maxWidth = docWidth * STAMP_WIDTH_RATIO;
  const maxHeight = docHeight * STAMP_HEIGHT_RATIO;

  // Encaixa preservando a proporção do traço: uma rubrica esticada é a marca
  // visual de assinatura falsificada, mesmo quando não é.
  let stampWidth = maxWidth;
  let stampHeight = stampWidth / sigRatio;
  if (stampHeight > maxHeight) {
    stampHeight = maxHeight;
    stampWidth = stampHeight * sigRatio;
  }

  const stampCenter = docLeft + anchor.signatureCenterX * docWidth;
  const stampBottom = docTop + (anchor.signatureBaselineY - STAMP_LIFT_RATIO) * docHeight;

  pdf.addImage(
    input.signatureDataUrl,
    'PNG',
    stampCenter - stampWidth / 2,
    stampBottom - stampHeight,
    stampWidth,
    stampHeight,
  );

  // ── Data, no campo que o recibo já reserva ────────────────────────────────
  if (anchor.dateCenterX !== null && anchor.dateBaselineY !== null) {
    const dateText = input.signedAt.toLocaleDateString('pt-BR');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(20);
    pdf.text(
      dateText,
      docLeft + anchor.dateCenterX * docWidth,
      docTop + (anchor.dateBaselineY - STAMP_LIFT_RATIO) * docHeight,
      { align: 'center' },
    );
  }

  // ── Prova, em letra miúda abaixo do documento ─────────────────────────────
  // Não é uma folha nova: é o rodapé da mesma página, no espaço que sobra
  // porque o contracheque ocupa pouco mais de meia folha A4.
  renderProofFootnote(pdf, input, docTop + docHeight + 4);
}

/**
 * Carimbo de auditoria em letra miúda: quem assinou, quando, e o hash.
 *
 * Fica abaixo do documento, na mesma página. É o que sustenta o comprovante
 * fora do sistema — sem data, identificação e hash, a rubrica estampada seria
 * só um desenho sobre uma imagem.
 */
function renderProofFootnote(pdf: any, input: SignedPdfInput, top: number) {
  const usableWidth = A4_WIDTH - MARGIN * 2;
  if (top > A4_HEIGHT - MARGIN - 8) return; // não cabe: não empurra para outra folha

  let y = top;

  pdf.setDrawColor(190);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, MARGIN + usableWidth, y);
  y += 3.5;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(70);

  const identity = [
    input.employee.name,
    input.employee.cpf ? `CPF ${input.employee.cpf}` : null,
    (input.employee.payroll_code || input.document.payroll_code)
      ? `matrícula ${input.employee.payroll_code || input.document.payroll_code}`
      : null,
    // A visualização vem antes da assinatura na linha porque é o que aconteceu
    // antes: o comprovante conta a sequência, não só o desfecho.
    input.document.first_viewed_at
      ? `aberto em ${new Date(input.document.first_viewed_at).toLocaleString('pt-BR')}`
      : null,
    `assinado em ${input.signedAt.toLocaleString('pt-BR')}`,
  ].filter(Boolean).join(' · ');

  pdf.text(identity, MARGIN, y);
  y += 3.2;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.2);
  pdf.setTextColor(110);

  const notice = pdf.splitTextToSize(VALIDITY_NOTICE, usableWidth) as string[];
  pdf.text(notice, MARGIN, y);
  y += notice.length * 2.6;

  if (input.document.original_sha256) {
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5.8);
    const hash = pdf.splitTextToSize(
      `SHA-256 do original: ${input.document.original_sha256}`,
      usableWidth,
    ) as string[];
    pdf.text(hash, MARGIN, y);
  }

  pdf.setTextColor(0);
}

/**
 * Bloco de assinatura completo, para quando não há âncora no documento.
 *
 * Continua na MESMA página — abaixo do documento, não numa folha nova. Aqui a
 * rubrica vem com linha e identificação próprias, porque não há linha no
 * documento para pousar sobre.
 */
function renderSignatureBlock(
  pdf: any,
  input: SignedPdfInput,
  top: number,
  usableWidth: number,
  sigRatio: number,
) {
  if (top > A4_HEIGHT - MARGIN - 30) {
    // Documento alto demais: só o rodapé de prova cabe.
    renderProofFootnote(pdf, input, Math.min(top, A4_HEIGHT - MARGIN - 8));
    return;
  }

  let y = top;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(0);
  pdf.text('DECLARO TER RECEBIDO A IMPORTÂNCIA LÍQUIDA DISCRIMINADA NESTE RECIBO', MARGIN, y);
  y += 6;

  let stampWidth = Math.min(usableWidth * 0.35, 60);
  let stampHeight = stampWidth / sigRatio;
  if (stampHeight > 22) { stampHeight = 22; stampWidth = stampHeight * sigRatio; }

  pdf.addImage(input.signatureDataUrl, 'PNG', MARGIN, y, stampWidth, stampHeight);
  y += stampHeight + 1.5;

  pdf.setDrawColor(60);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, y, MARGIN + 80, y);
  y += 4;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('ASSINATURA DO FUNCIONÁRIO', MARGIN, y);

  pdf.text(
    `DATA ${input.signedAt.toLocaleDateString('pt-BR')}`,
    MARGIN + 95,
    y,
  );
  y += 5;

  renderProofFootnote(pdf, input, y);
}

// ── Medidas de imagem ────────────────────────────────────────────────────────

function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Imagem inválida ao montar o PDF assinado'));
    img.src = dataUrl;
  });
}

/** Proporção largura/altura, com reserva quando a imagem não pode ser medida. */
async function aspectRatio(dataUrl: string, fallback: number): Promise<number> {
  try {
    const { width, height } = await imageDimensions(dataUrl);
    if (!height) return fallback;
    return width / height;
  } catch {
    return fallback;
  }
}
