// netlify/functions/evolution-proxy.ts
// Proxy server-side para Evolution API (self-hosted, Baileys).
// Evita expor a apikey no browser e centraliza a validação do host de destino.
//
// Headers de controle:
//   x-evo-base-url : URL base da instalação Evolution (ex: https://evo.meridiana.com.br)
//   x-evo-api-key  : AUTHENTICATION_API_KEY global ou token da instância
//   x-evo-instance : nome da instância (obrigatório em todas as ações menos create)
//   x-evo-action   : create | connect | state | logout | delete | send-text | send-media | set-webhook | find-webhook

import type { Handler, HandlerEvent } from '@netlify/functions';

type EvoAction =
  | 'create'
  | 'connect'
  | 'state'
  | 'logout'
  | 'delete'
  | 'send-text'
  | 'send-media'
  | 'set-webhook'
  | 'find-webhook'
  | 'fetch-instances'
  | 'check-numbers';

const ROUTES: Record<EvoAction, { method: string; path: (instance: string) => string }> = {
  'create':       { method: 'POST',   path: ()  => '/instance/create' },
  'connect':      { method: 'GET',    path: (i) => `/instance/connect/${encodeURIComponent(i)}` },
  'state':        { method: 'GET',    path: (i) => `/instance/connectionState/${encodeURIComponent(i)}` },
  'logout':       { method: 'DELETE', path: (i) => `/instance/logout/${encodeURIComponent(i)}` },
  'delete':       { method: 'DELETE', path: (i) => `/instance/delete/${encodeURIComponent(i)}` },
  'send-text':    { method: 'POST',   path: (i) => `/message/sendText/${encodeURIComponent(i)}` },
  'send-media':   { method: 'POST',   path: (i) => `/message/sendMedia/${encodeURIComponent(i)}` },
  'set-webhook':  { method: 'POST',   path: (i) => `/webhook/set/${encodeURIComponent(i)}` },
  'find-webhook': { method: 'GET',    path: (i) => `/webhook/find/${encodeURIComponent(i)}` },
  // Não exigem instância na rota, mas são usados no diagnóstico de conexão
  'fetch-instances': { method: 'GET',  path: ()  => '/instance/fetchInstances' },
  // Consulta se números existem no WhatsApp. Exige socket vivo e não envia nada.
  'check-numbers':   { method: 'POST', path: (i) => `/chat/whatsappNumbers/${encodeURIComponent(i)}` },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'x-evo-base-url',
    'x-evo-api-key',
    'x-evo-instance',
    'x-evo-action',
  ].join(', '),
};

/**
 * O base_url vem do banco e é editável na UI, então este proxy poderia ser usado
 * como pivô para alcançar a rede interna do provedor. A validação abaixo restringe
 * o destino a hosts públicos via HTTPS, ou a uma allowlist explícita.
 *
 * EVOLUTION_ALLOWED_HOSTS: lista separada por vírgula de hostnames liberados,
 * usada para permitir HTTP ou hosts privados em ambientes controlados.
 */
function validateTarget(rawUrl: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'x-evo-base-url não é uma URL válida' };
  }

  const allowlist = (process.env.EVOLUTION_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  const host = url.hostname.toLowerCase();

  if (allowlist.includes(host)) return { url };

  if (url.protocol !== 'https:') {
    return { error: 'Apenas HTTPS é aceito. Para HTTP, inclua o host em EVOLUTION_ALLOWED_HOSTS.' };
  }

  // Bloqueia loopback, link-local, ranges privados e nomes internos
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === '::1' ||
    host === '[::1]';

  if (isPrivate) {
    return { error: 'Host de destino não permitido (endereço privado ou local).' };
  }

  return { url };
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const baseUrl  = event.headers['x-evo-base-url'];
  const apiKey   = event.headers['x-evo-api-key'];
  const instance = event.headers['x-evo-instance'] || '';
  const action   = (event.headers['x-evo-action'] || 'send-text') as EvoAction;

  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' };

  if (!baseUrl || !apiKey) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Headers x-evo-base-url e x-evo-api-key são obrigatórios' }),
    };
  }

  const route = ROUTES[action];
  if (!route) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Ação desconhecida: ${action}` }),
    };
  }

  // Estas duas não levam a instância na rota
  const dispensamInstancia: EvoAction[] = ['create', 'fetch-instances'];

  if (!dispensamInstancia.includes(action) && !instance) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Header x-evo-instance é obrigatório para a ação ${action}` }),
    };
  }

  const validated = validateTarget(baseUrl);
  if ('error' in validated) {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: validated.error }) };
  }

  // Monta a URL final preservando qualquer path base (ex: https://host/evolution)
  const basePath   = validated.url.pathname.replace(/\/+$/, '');
  const targetUrl  = `${validated.url.origin}${basePath}${route.path(instance)}`;
  const sendsBody  = route.method === 'POST';

  if (sendsBody && event.body) {
    try {
      JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: 'Body JSON inválido' }) };
    }
  }

  try {
    const res = await fetch(targetUrl, {
      method: route.method,
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: sendsBody ? (event.body || '{}') : undefined,
      // A conexão inicial da instância pode demorar. Netlify corta em 10s no plano
      // padrão, então o cliente precisa tratar timeout na ação connect.
      signal: AbortSignal.timeout(25_000),
    });

    const responseBody = await res.text();

    return {
      statusCode: res.status,
      headers: {
        ...CORS,
        'Content-Type': res.headers.get('content-type') || 'application/json',
      },
      body: responseBody,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Falha ao alcançar o Evolution API: ${message}` }),
    };
  }
};

export { handler };
