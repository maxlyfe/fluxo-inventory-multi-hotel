// netlify/functions/ar-billing-retry.ts
// Retentativa agendada das cobranças que falharam ou ficaram pendentes.
//
// Roda de hora em hora (minuto 25, fora do topo da hora onde os outros jobs se
// concentram). Volume é baixo, então cabe no budget de 26s da function agendada;
// se crescer, seguir o padrão pickup-daily-snapshot → worker -background.
//
// Ao esgotar AR_BILLING_MAX_ATTEMPTS o disparo para de ser tentado e fica visível
// na fila com dias_parado: o e-mail nunca é a última linha de defesa, a fila é.

import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { processDispatches, listRetryable } from './lib/ar-billing';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const handler = schedule('25 * * * *', async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[AR Billing Retry] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return { statusCode: 500 };
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const ids = await listRetryable(svc, 100);
    if (!ids.length) {
      console.log('[AR Billing Retry] Nada a reenviar');
      return { statusCode: 200 };
    }

    const outcome = await processDispatches(svc, ids);
    console.log(
      `[AR Billing Retry] ${ids.length} candidato(s) · ${outcome.sent.length} enviado(s) · ` +
      `${outcome.failed.length} falha(s) · ${outcome.skipped.length} ignorado(s)`
    );
    for (const s of outcome.skipped) {
      console.log(`[AR Billing Retry] ignorado ${s.dispatch_id}: ${s.reason}`);
    }
    for (const f of outcome.failed) {
      console.log(`[AR Billing Retry] falhou ${f.dispatch_id}: ${f.error}`);
    }
    return { statusCode: 200 };
  } catch (e) {
    console.error('[AR Billing Retry] Erro no job:', e);
    return { statusCode: 500 };
  }
});

export { handler };
