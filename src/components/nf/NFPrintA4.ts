// src/components/nf/NFPrintA4.ts
// Impressão A4 estruturada para NFS-e e DANFE (NF-e simplificado).
// NFC-e continua no cupom 80mm (NFInvoiceModal/NFPrintReceipt).

import type { NFHotelConfig } from '../../types/nf';

interface PrintInvoice {
  tipo: 'nfse' | 'nfe' | 'nfce';
  status?: string;
  numero_nf?: string | null;
  serie?: string | null;
  numero_rps?: string | null;
  chave_acesso?: string | null;
  numero_protocolo?: string | null;
  codigo_verificacao?: string | null;
  url_consulta?: string | null;
  booking_number?: string | null;
  room_description?: string | null;
  tomador_nome?: string;
  tomador_cpf_cnpj?: string | null;
  tomador_doc_tipo?: string;
  tomador_email?: string | null;
  tomador_endereco?: string | null;
  valor_total?: number;
  created_at?: string;
}

interface PrintItem {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  ncm?: string | null;
  cfop?: string | null;
  icms_aliquota?: number | null;
  icms_valor?: number | null;
  codigo_servico?: string | null;
  iss_aliquota?: number | null;
  iss_valor?: number | null;
}

const fmt = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chaveFormatada = (chave: string) => chave.replace(/(\d{4})/g, '$1 ').trim();

const BASE_CSS = `
@page { size: A4; margin: 12mm; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
.doc { width: 100%; }
.box { border: 1px solid #333; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; }
.row { display: flex; gap: 8px; }
.row > .box { flex: 1; margin-bottom: 0; }
.row { margin-bottom: 8px; }
.title { text-align: center; font-size: 15px; font-weight: 900; letter-spacing: 0.5px; }
.subtitle { text-align: center; font-size: 10px; color: #444; margin-top: 2px; }
.lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #666; letter-spacing: 0.4px; }
.val { font-size: 11px; font-weight: 600; }
.val-lg { font-size: 13px; font-weight: 800; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 8px; text-transform: uppercase; color: #666; text-align: left; border-bottom: 1px solid #333; padding: 4px 6px; }
td { font-size: 10px; padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.totais { display: flex; justify-content: flex-end; gap: 16px; padding: 8px 10px; }
.totais .t { text-align: right; }
.chave { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 800; letter-spacing: 1px; text-align: center; }
.watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 52px; font-weight: 900; color: rgba(220, 38, 38, 0.13); transform: rotate(-24deg); pointer-events: none; z-index: 0; }
.footer { text-align: center; font-size: 8px; color: #888; margin-top: 10px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 12px; }
`;

function headerPrestador(config: NFHotelConfig | null): string {
  if (!config) return '';
  const endereco = [config.endereco_logradouro, config.endereco_numero, config.endereco_bairro,
    config.endereco_cidade, config.endereco_uf, config.endereco_cep && `CEP ${config.endereco_cep}`]
    .filter(Boolean).join(', ');
  const logoHtml = config.logo_url
    ? `<img src="${esc(config.logo_url)}" style="max-height:60px;max-width:120px;object-fit:contain;flex-shrink:0" />`
    : '';

  return `
    <div class="box">
      <div style="display:flex;align-items:center;gap:12px">
        ${logoHtml}
        <div style="flex:1">
          <div style="font-size:16px;font-weight:900">${esc(config.nome_fantasia || config.razao_social || '')}</div>
          ${config.razao_social ? `<div class="val" style="font-weight:400">${esc(config.razao_social)}</div>` : ''}
        </div>
      </div>
      <div class="grid3" style="margin-top:6px">
        <div><span class="lbl">CNPJ</span><br/><span class="val">${esc(config.cnpj || '—')}</span></div>
        ${config.inscricao_municipal ? `<div><span class="lbl">Inscrição Municipal</span><br/><span class="val">${esc(config.inscricao_municipal)}</span></div>` : ''}
        ${config.inscricao_estadual ? `<div><span class="lbl">Inscrição Estadual</span><br/><span class="val">${esc(config.inscricao_estadual)}</span></div>` : ''}
      </div>
      ${endereco ? `<div style="margin-top:4px"><span class="lbl">Endereço</span><br/><span class="val" style="font-weight:400">${esc(endereco)}</span></div>` : ''}
      <div class="grid2" style="margin-top:4px">
        ${config.telefone ? `<div><span class="lbl">Telefone</span> <span class="val" style="font-weight:400">${esc(config.telefone)}</span></div>` : ''}
        ${config.email ? `<div><span class="lbl">E-mail</span> <span class="val" style="font-weight:400">${esc(config.email)}</span></div>` : ''}
      </div>
    </div>`;
}

function boxTomador(inv: PrintInvoice, titulo: string): string {
  const docLabel = inv.tomador_doc_tipo === 'passaporte' ? 'Passaporte' : inv.tomador_doc_tipo === 'cnpj' ? 'CNPJ' : 'CPF';
  return `
    <div class="box">
      <div class="lbl" style="margin-bottom:4px">${titulo}</div>
      <div class="val-lg">${esc(inv.tomador_nome || '—')}</div>
      <div class="grid2" style="margin-top:4px">
        <div><span class="lbl">${docLabel}</span><br/><span class="val">${esc(inv.tomador_cpf_cnpj || '—')}</span></div>
        ${inv.tomador_email ? `<div><span class="lbl">E-mail</span><br/><span class="val" style="font-weight:400">${esc(inv.tomador_email)}</span></div>` : ''}
      </div>
      ${inv.tomador_endereco ? `<div style="margin-top:4px"><span class="lbl">Endereço</span><br/><span class="val" style="font-weight:400">${esc(inv.tomador_endereco)}</span></div>` : ''}
      ${(inv.booking_number || inv.room_description) ? `<div style="margin-top:4px"><span class="lbl">Reserva</span> <span class="val" style="font-weight:400">${esc(inv.booking_number || '—')} · UH ${esc(inv.room_description || '—')}</span></div>` : ''}
    </div>`;
}

function isHomolog(config: NFHotelConfig | null, inv: PrintInvoice): boolean {
  return config?.ambiente === 'homologacao' || inv.status === 'contingencia';
}

// ── NFS-e (A4) ────────────────────────────────────────────────────────────────

function buildNfseHtml(inv: PrintInvoice, items: PrintItem[], config: NFHotelConfig | null): string {
  const emissao = inv.created_at ? new Date(inv.created_at) : new Date();
  const issTotal = items.reduce((s, i) => s + (Number(i.iss_valor) || 0), 0);

  const itemRows = items.map(i => `
    <tr>
      <td>${esc(i.descricao)}</td>
      <td class="num">${esc(i.codigo_servico || config?.codigo_servico || '—')}</td>
      <td class="num">${fmt(i.quantidade)}</td>
      <td class="num">${fmt(i.valor_unitario)}</td>
      <td class="num">${i.iss_aliquota != null ? fmt(i.iss_aliquota) + '%' : '—'}</td>
      <td class="num">${fmt(i.iss_valor)}</td>
      <td class="num"><b>${fmt(i.valor_total)}</b></td>
    </tr>`).join('');

  return `
    ${isHomolog(config, inv) ? `<div class="watermark">${inv.status === 'contingencia' ? 'CONTINGÊNCIA' : 'SEM VALOR FISCAL'}</div>` : ''}
    <div class="doc">
      ${headerPrestador(config)}
      <div class="box" style="background:#f5f5f5">
        <div class="title">NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e</div>
        <div class="subtitle">Prefeitura de ${esc(config?.endereco_cidade || '')} ${config?.endereco_uf ? '— ' + esc(config.endereco_uf) : ''}</div>
        <div class="grid3" style="margin-top:8px;text-align:center">
          <div><span class="lbl">Número / Série</span><br/><span class="val-lg">${esc(inv.numero_nf || inv.numero_rps || '—')} / ${esc(inv.serie || 'NFS')}</span></div>
          <div><span class="lbl">Data de Emissão</span><br/><span class="val-lg">${emissao.toLocaleDateString('pt-BR')} ${emissao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div><span class="lbl">Código de Verificação</span><br/><span class="val-lg">${esc(inv.codigo_verificacao || '—')}</span></div>
        </div>
      </div>
      ${boxTomador(inv, 'Tomador do Serviço')}
      <div class="box">
        <div class="lbl" style="margin-bottom:6px">Discriminação dos Serviços</div>
        <table>
          <thead>
            <tr>
              <th>Descrição</th><th class="num">Cód. Serviço</th><th class="num">Qtd</th>
              <th class="num">Valor Unit. (R$)</th><th class="num">Alíq. ISS</th><th class="num">ISS (R$)</th><th class="num">Total (R$)</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="totais">
          <div class="t"><span class="lbl">Valor do ISS</span><br/><span class="val-lg">R$ ${fmt(issTotal)}</span></div>
          <div class="t"><span class="lbl">Valor Total dos Serviços</span><br/><span class="val-lg" style="font-size:16px">R$ ${fmt(inv.valor_total)}</span></div>
        </div>
      </div>
      <div class="box">
        <div class="grid2">
          <div><span class="lbl">Protocolo</span><br/><span class="val">${esc(inv.numero_protocolo || '—')}</span></div>
          <div><span class="lbl">Consulta de Autenticidade</span><br/><span class="val" style="font-weight:400">${esc(inv.url_consulta || 'Portal da prefeitura, pelo código de verificação')}</span></div>
        </div>
      </div>
      <div class="footer">Documento auxiliar da NFS-e — LyFe Hoteles · Sistema de Gestão</div>
    </div>`;
}

// ── DANFE simplificado (A4) ──────────────────────────────────────────────────

function buildDanfeHtml(inv: PrintInvoice, items: PrintItem[], config: NFHotelConfig | null): string {
  const emissao = inv.created_at ? new Date(inv.created_at) : new Date();
  const icmsTotal = items.reduce((s, i) => s + (Number(i.icms_valor) || 0), 0);

  const itemRows = items.map(i => `
    <tr>
      <td>${esc(i.descricao)}</td>
      <td class="num">${esc(i.ncm || '—')}</td>
      <td class="num">${esc(i.cfop || '—')}</td>
      <td class="num">${fmt(i.quantidade)}</td>
      <td class="num">${fmt(i.valor_unitario)}</td>
      <td class="num"><b>${fmt(i.valor_total)}</b></td>
    </tr>`).join('');

  return `
    ${isHomolog(config, inv) ? `<div class="watermark">${inv.status === 'contingencia' ? 'CONTINGÊNCIA' : 'SEM VALOR FISCAL'}</div>` : ''}
    <div class="doc">
      ${headerPrestador(config)}
      <div class="box" style="background:#f5f5f5">
        <div class="title">DANFE — Documento Auxiliar da Nota Fiscal Eletrônica</div>
        <div class="subtitle">0 — Saída · Natureza da operação: Venda de mercadoria</div>
        <div class="grid3" style="margin-top:8px;text-align:center">
          <div><span class="lbl">Número / Série</span><br/><span class="val-lg">${esc(inv.numero_nf || '—')} / ${esc(inv.serie || '1')}</span></div>
          <div><span class="lbl">Data de Emissão</span><br/><span class="val-lg">${emissao.toLocaleDateString('pt-BR')} ${emissao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div><span class="lbl">Protocolo de Autorização</span><br/><span class="val-lg">${esc(inv.numero_protocolo || '—')}</span></div>
        </div>
      </div>
      ${inv.chave_acesso ? `
      <div class="box" style="text-align:center">
        <div class="lbl">Chave de Acesso</div>
        <div class="chave">${chaveFormatada(inv.chave_acesso)}</div>
        <div style="font-size:8px;color:#666;margin-top:2px">Consulte a autenticidade em www.nfe.fazenda.gov.br/portal ou no site da SEFAZ autorizadora</div>
      </div>` : ''}
      ${boxTomador(inv, 'Destinatário / Remetente')}
      <div class="box">
        <div class="lbl" style="margin-bottom:6px">Dados dos Produtos</div>
        <table>
          <thead>
            <tr>
              <th>Descrição</th><th class="num">NCM</th><th class="num">CFOP</th>
              <th class="num">Qtd</th><th class="num">Valor Unit. (R$)</th><th class="num">Total (R$)</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="totais">
          <div class="t"><span class="lbl">Valor do ICMS</span><br/><span class="val-lg">R$ ${fmt(icmsTotal)}</span></div>
          <div class="t"><span class="lbl">Valor Total da Nota</span><br/><span class="val-lg" style="font-size:16px">R$ ${fmt(inv.valor_total)}</span></div>
        </div>
      </div>
      <div class="footer">DANFE simplificado — sem valor fiscal quando emitido em homologação · LyFe Hoteles</div>
    </div>`;
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Abre a janela de impressão A4 para NFS-e ou NF-e (DANFE). NFC-e não usa este módulo. */
export function printNFA4(invoice: PrintInvoice, items: PrintItem[], config: NFHotelConfig | null): void {
  const body = invoice.tipo === 'nfse'
    ? buildNfseHtml(invoice, items, config)
    : buildDanfeHtml(invoice, items, config);

  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${invoice.tipo === 'nfse' ? 'NFS-e' : 'DANFE'} ${invoice.numero_nf || ''}</title>
<style>${BASE_CSS}</style></head><body>${body}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\/script>
</body></html>`);
  win.document.close();
}

export type { PrintInvoice, PrintItem };
