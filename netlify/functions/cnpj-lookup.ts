// netlify/functions/cnpj-lookup.ts
// Proxy autenticado para a consulta de CNPJ na cnpja.com.
//
// Por que existe: a chave da API estava hardcoded em src/lib/supplierService.ts,
// ou seja, ia para o bundle público — qualquer pessoa com o site aberto podia
// extrair a chave e gastar os créditos da conta. Aqui ela vive só no ambiente do
// servidor, e a chamada exige um usuário logado com acesso ao hotel.
//
// Requer a env CNPJA_API_KEY na Netlify. Enquanto ela não existir, o front cai
// automaticamente na chamada direta (compatibilidade durante a migração).

import type { Handler, HandlerEvent } from '@netlify/functions';
import { requireUser, requireHotelAccess, corsHeaders, jsonResponse, errorResponse, HttpError } from './lib/auth';

const CNPJA_BASE = 'https://api.cnpja.com';

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event, 'POST, OPTIONS'), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(event, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    const apiKey = process.env.CNPJA_API_KEY;
    if (!apiKey) throw new HttpError(503, 'CNPJA_API_KEY não configurada no ambiente');

    const body = JSON.parse(event.body || '{}') as { cnpj?: string; hotel_id?: string };
    const clean = (body.cnpj ?? '').replace(/\D/g, '');
    if (clean.length !== 14) throw new HttpError(400, 'CNPJ deve ter 14 dígitos');

    // Consulta custa crédito: exige usuário logado e, quando informado, acesso ao
    // hotel. Sem isso a function seria só a mesma torneira aberta em outro lugar.
    const { userId } = await requireUser(event);
    if (body.hotel_id) await requireHotelAccess(userId, body.hotel_id);

    const res = await fetch(`${CNPJA_BASE}/office/${clean}?simples=true&registrations=BR`, {
      headers: { Authorization: apiKey },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Resposta negativa da Receita é resposta, não falha de transporte: mesma
      // convenção de status do nf-proxy.
      return jsonResponse(event, res.status === 404 ? 404 : 502, {
        ok: false,
        error: `Erro ao consultar CNPJ (${res.status}): ${detail || res.statusText}`,
      });
    }

    return jsonResponse(event, 200, { ok: true, data: await res.json() });
  } catch (err) {
    return errorResponse(event, err);
  }
};

export { handler };
