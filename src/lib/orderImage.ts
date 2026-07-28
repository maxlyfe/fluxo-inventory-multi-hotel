// src/lib/orderImage.ts
// Geração da imagem do pedido, compartilhada entre a cópia manual para a área de
// transferência (/purchases/list, /budget-history) e o disparo automático no
// WhatsApp na aprovação.
//
// A imagem é sempre filtrada por fornecedor: uma lista pode conter itens de
// vários, e enviar a tabela completa exporia o preço dos concorrentes.

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export interface OrderHotel {
  name: string;
  fantasy_name?: string | null;
  corporate_name?: string | null;
  cnpj?: string | null;
}

export interface OrderItem {
  name: string;
  quantity: number;
  unit: string;
  supplier: string | null;
  unitPrice: number | null;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const brl = (n: number): string => `R$ ${n.toFixed(2).replace('.', ',')}`;

/** Compara nomes de fornecedor ignorando caixa, acento e espaço nas pontas */
export function sameSupplier(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  return norm(a) === norm(b);
}

/** Lista os fornecedores distintos de um conjunto de itens, preservando a grafia original */
export function distinctSuppliers(items: OrderItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const s = (item.supplier || '').trim();
    if (!s) continue;
    if (!out.some(existing => sameSupplier(existing, s))) out.push(s);
  }
  return out;
}

/**
 * Texto que acompanha a imagem no WhatsApp.
 * Identifica a unidade compradora, que é o que o fornecedor precisa para faturar.
 */
export function buildOrderMessageText(hotel: OrderHotel, supplierName: string): string {
  const linhas = [
    `${supplierName},`,
    '',
    'Pedido para',
    `FANTASIA: *${hotel.fantasy_name || hotel.name}*`,
  ];
  if (hotel.corporate_name) linhas.push(`RAZÃO SOCIAL: ${hotel.corporate_name}`);
  if (hotel.cnpj) linhas.push(`CNPJ: ${hotel.cnpj}`);
  return linhas.join('\n');
}

/** HTML da tabela do pedido, já filtrado no fornecedor informado */
export function buildOrderImageHtml(params: {
  hotel: OrderHotel;
  supplierName: string;
  items: OrderItem[];
  date?: Date;
}): string {
  const { hotel, supplierName, items } = params;
  const hoje = format(params.date || new Date(), 'dd/MM/yyyy', { locale: ptBR });

  const doFornecedor = items.filter(i => sameSupplier(i.supplier, supplierName));
  const total = doFornecedor.reduce(
    (acc, i) => acc + (i.quantity || 0) * (i.unitPrice || 0),
    0,
  );

  const linhas = doFornecedor
    .map((item, idx) => {
      const q = item.quantity || 0;
      const p = item.unitPrice;
      return `
        <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${esc(item.name)}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${esc(q)}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${esc(item.unit)}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${p != null ? brl(p) : '-'}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:600;">${brl(q * (p || 0))}</td>
        </tr>`;
    })
    .join('');

  const th = 'padding:12px;border-bottom:2px solid #e5e7eb;font-size:12px;text-transform:uppercase;';

  return `
    <div style="font-family: Arial, sans-serif; padding:20px; background:#fff; color:#333; width:900px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
        <h2 style="font-size:24px; margin:0;">Pedido de compra</h2>
        <div style="text-align:right; font-size:14px; color:#555;">${hoje}</div>
      </div>

      <div style="margin-bottom:16px; font-size:15px;">
        <strong>Fornecedor:</strong> ${esc(supplierName)}
      </div>

      <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
        <thead>
          <tr style="background-color:#f9fafb; text-align:left;">
            <th style="${th}">Item</th>
            <th style="${th}">Quantidade</th>
            <th style="${th}">Unidade</th>
            <th style="${th}">Valor unitário</th>
            <th style="${th}">Valor total</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr style="background-color:#f9fafb;">
            <td colspan="4" style="padding:12px;border-top:2px solid #e5e7eb;text-align:right;font-weight:bold;">Total:</td>
            <td style="padding:12px;border-top:2px solid #e5e7eb;font-weight:bold;">${brl(total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:20px; padding-top:15px; border-top:1px solid #eee; color:#444;">
        <p style="margin:0 0 5px 0; font-size:16px;"><strong>Pedido para</strong></p>
        <p style="margin:5px 0; font-size:14px;">FANTASIA: <strong>${esc(hotel.fantasy_name || hotel.name)}</strong></p>
        ${hotel.corporate_name ? `<p style="margin:5px 0;font-size:14px;">RAZÃO SOCIAL: ${esc(hotel.corporate_name)}</p>` : ''}
        ${hotel.cnpj ? `<p style="margin:5px 0;font-size:14px;">CNPJ: ${esc(hotel.cnpj)}</p>` : ''}
      </div>
    </div>`;
}

/** Renderiza o HTML fora da tela e devolve o canvas */
async function renderToCanvas(html: string): Promise<HTMLCanvasElement> {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.style.position = 'absolute';
  holder.style.left = '-9999px';
  holder.style.top = '0';
  document.body.appendChild(holder);

  try {
    const { default: html2canvas } = await import('html2canvas');
    return await html2canvas(holder.firstElementChild as HTMLElement, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });
  } finally {
    // Remove no finally: se o html2canvas lançar, o nó não fica órfão no DOM
    document.body.removeChild(holder);
  }
}

/**
 * Gera a imagem do pedido em base64 puro, sem o prefixo data URI.
 * É o formato que o Evolution API aceita no campo `media` do sendMedia.
 */
export async function generateOrderImageBase64(params: {
  hotel: OrderHotel;
  supplierName: string;
  items: OrderItem[];
  date?: Date;
}): Promise<string> {
  const canvas = await renderToCanvas(buildOrderImageHtml(params));
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

/** Gera a imagem do pedido como Blob, para cópia na área de transferência */
export async function generateOrderImageBlob(params: {
  hotel: OrderHotel;
  supplierName: string;
  items: OrderItem[];
  date?: Date;
}): Promise<Blob> {
  const canvas = await renderToCanvas(buildOrderImageHtml(params));
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao converter a imagem do pedido.'));
    }, 'image/png');
  });
}
