// netlify/functions/ar-billing-send.ts
// Envia cobranças de parceiros faturados.
//
// O envio NUNCA acontece no browser: em emissão em lote o operador fecha a aba no
// meio e as cobranças pendentes se perderiam em silêncio — exatamente o modo de
// falha que a fila existe para prevenir.

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  requireUser, requireHotelAccess, requirePermission,
  corsHeaders, jsonResponse, errorResponse, serviceClient, HttpError,
} from './lib/auth';
import { processDispatches } from './lib/ar-billing';

interface Payload {
  hotel_id: string;
  dispatch_ids?: string[];
  ar_title_ids?: string[];
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(event, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    const body = JSON.parse(event.body || '{}') as Payload;
    if (!body.hotel_id) throw new HttpError(400, 'hotel_id obrigatório');
    if (!body.dispatch_ids?.length && !body.ar_title_ids?.length) {
      throw new HttpError(400, 'Informe dispatch_ids ou ar_title_ids');
    }

    // Enviar e-mail para cliente externo é irreversível: exige permissão própria,
    // e a checagem acontece no SERVIDOR, não só no botão da tela.
    const { userId } = await requireUser(event);
    await requireHotelAccess(userId, body.hotel_id);
    await requirePermission(userId, 'finances.billing.send', 'finances');

    const svc = serviceClient();

    let ids = body.dispatch_ids ?? [];
    if (!ids.length && body.ar_title_ids?.length) {
      const { data, error } = await svc
        .from('ar_billing_dispatches')
        .select('id')
        .eq('hotel_id', body.hotel_id)
        .in('ar_title_id', body.ar_title_ids);
      if (error) throw new HttpError(500, error.message);
      ids = (data ?? []).map((r: any) => r.id);
    }

    if (!ids.length) {
      return jsonResponse(event, 200, {
        ok: true, sent: [], failed: [], skipped: [],
        message: 'Nenhum disparo pendente para os títulos informados.',
      });
    }

    const outcome = await processDispatches(svc, ids, { hotelId: body.hotel_id });
    return jsonResponse(event, 200, { ok: true, ...outcome });
  } catch (err) {
    return errorResponse(event, err);
  }
};

export { handler };
