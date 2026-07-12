// netlify/functions/pickup-daily-snapshot.ts
// Gatilho agendado (11:00 UTC = 8h BRT): dispara o worker em background
// pickup-daily-worker-background, que faz a captura pesada na Erbon
// (hospedagem, segmentsview, ocupação mensal) para todos os hotéis.
//
// Functions agendadas do Netlify têm limite de 26s síncronos — a soma das
// chamadas Erbon (~2,5–7s cada, dezenas por dia) não cabe. O worker com
// sufixo -background tem budget de 15 minutos.

import { schedule } from '@netlify/functions';

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const handler = schedule('0 11 * * *', async () => {
  const siteUrl = process.env.URL || '';
  if (!siteUrl) {
    console.error('[Pickup Daily] env URL ausente — não é possível disparar o worker');
    return { statusCode: 500 };
  }

  const res = await fetch(`${siteUrl}/.netlify/functions/pickup-daily-worker-background`, {
    method: 'POST',
    headers: { 'x-job-key': SUPABASE_SERVICE_KEY.slice(-24) },
  });

  // Background functions respondem 202 imediatamente e seguem processando
  console.log(`[Pickup Daily] Worker disparado → HTTP ${res.status}`);
  return { statusCode: res.status === 202 || res.ok ? 200 : 500 };
});

export { handler };
