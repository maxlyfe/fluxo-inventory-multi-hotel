// netlify/functions/erbon-proxy.ts
// Proxy server-side para API Erbon – evita CORS no browser em produção

import type { Handler, HandlerEvent } from '@netlify/functions';

const DEFAULT_BASE = 'https://api.erbonsoftware.com';

function sanitizeBaseUrl(raw?: string): string {
  if (!raw) return DEFAULT_BASE;
  // Remove /swagger/index.html ou /swagger que o usuário pode colar por engano
  let url = raw.replace(/\/swagger(\/index\.html)?$/i, '').replace(/\/+$/, '');
  return url || DEFAULT_BASE;
}

const handler: Handler = async (event: HandlerEvent) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-erbon-base-url, x-erbon-path, onlyProducts, transactionDate',
      },
      body: '',
    };
  }

  const erbonPath = event.headers['x-erbon-path'];
  const erbonBase = sanitizeBaseUrl(event.headers['x-erbon-base-url']);

  if (!erbonPath) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing x-erbon-path header' }),
    };
  }

  const targetUrl = `${erbonBase}${erbonPath}`;

  // Forward headers relevantes (excluindo os custom x-erbon-*)
  const forwardHeaders: Record<string, string> = {};
  if (event.headers['content-type']) forwardHeaders['Content-Type'] = event.headers['content-type'];
  if (event.headers['authorization']) forwardHeaders['Authorization'] = event.headers['authorization'];
  if (event.headers['onlyproducts']) forwardHeaders['onlyProducts'] = event.headers['onlyproducts'];
  if (event.headers['transactiondate']) forwardHeaders['transactionDate'] = event.headers['transactiondate'];

  try {
    const res = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: forwardHeaders,
      body: event.httpMethod !== 'GET' ? event.body : undefined,
    });

    const body = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': res.headers.get('content-type') || 'application/json',
      },
      body,
    };
  } catch (err: any) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: `Proxy error: ${err.message}` }),
    };
  }
};

export { handler };
