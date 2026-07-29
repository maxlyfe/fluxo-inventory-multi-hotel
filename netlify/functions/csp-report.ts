// netlify/functions/csp-report.ts
// Coletor de violações de CSP.
//
// Serve de rede de segurança para a CSP em modo bloqueante: se algum recurso
// legítimo for barrado, a violação aparece aqui em vez de virar uma tela
// quebrada silenciosa que só o usuário final vê.
//
// Ler as violações:  netlify logs:function csp-report
//
// Aceita os dois formatos que os navegadores mandam:
//   • report-uri  → { "csp-report": { ... } }            (Chrome, Firefox, Safari)
//   • report-to   → [ { "type": "csp-violation", ... } ] (Reporting API)

import type { Handler, HandlerEvent } from '@netlify/functions';

// Violações que não indicam bug nosso: extensões de navegador e apps que
// injetam script na página. Poluiriam o log sem ação possível do nosso lado.
const IGNORED_SCHEMES = ['chrome-extension:', 'moz-extension:', 'safari-extension:', 'safari-web-extension:', 'about:'];

interface Violation {
  documentUri?: string;
  directive?: string;
  blockedUri?: string;
}

function normalize(payload: unknown): Violation[] {
  if (!payload || typeof payload !== 'object') return [];

  // Formato report-to: array de relatórios
  if (Array.isArray(payload)) {
    return payload
      .filter((r) => r?.type === 'csp-violation' && r?.body)
      .map((r) => ({
        documentUri: r.body.documentURL,
        directive:   r.body.effectiveDirective ?? r.body.disposition,
        blockedUri:  r.body.blockedURL,
      }));
  }

  // Formato report-uri: objeto único sob a chave "csp-report"
  const body = (payload as Record<string, any>)['csp-report'];
  if (!body) return [];
  return [{
    documentUri: body['document-uri'],
    directive:   body['effective-directive'] ?? body['violated-directive'],
    blockedUri:  body['blocked-uri'],
  }];
}

export const handler: Handler = async (event: HandlerEvent) => {
  // 204 sempre: o navegador não espera corpo e não deve reagir a erro nosso.
  const noContent = { statusCode: 204, body: '' };

  if (event.httpMethod !== 'POST' || !event.body) return noContent;

  // Um relatório de CSP é pequeno; corpo gigante é abuso do endpoint público.
  if (event.body.length > 8000) return noContent;

  try {
    for (const v of normalize(JSON.parse(event.body))) {
      const blocked = v.blockedUri ?? '';
      if (IGNORED_SCHEMES.some((s) => blocked.startsWith(s))) continue;

      console.warn(
        `[csp-violation] directive=${v.directive ?? '?'} blocked=${blocked || '(inline)'} page=${v.documentUri ?? '?'}`
      );
    }
  } catch {
    // Corpo malformado: ignora em silêncio, é endpoint público.
  }

  return noContent;
};
