// netlify/functions/whatsapp-proxy.ts
// Proxy server-side para Meta WhatsApp Cloud API — evita expor tokens no browser

import type { Handler, HandlerEvent } from '@netlify/functions';

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

const handler: Handler = async (event: HandlerEvent) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': [
          'Content-Type',
          'x-wa-phone-number-id',
          'x-wa-access-token',
          'x-wa-action',
        ].join(', '),
      },
      body: '',
    };
  }

  const phoneNumberId = event.headers['x-wa-phone-number-id'];
  const accessToken = event.headers['x-wa-access-token'];
  const action = event.headers['x-wa-action'] || 'send'; // send | verify

  if (!phoneNumberId || !accessToken) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing x-wa-phone-number-id or x-wa-access-token headers' }),
    };
  }

  try {
    let targetUrl: string;
    let method = event.httpMethod;
    let body = event.body;

    if (action === 'verify') {
      // Verificar status do número — GET
      targetUrl = `${META_GRAPH_URL}/${phoneNumberId}`;
      method = 'GET';
      body = undefined;
    } else {
      // Enviar mensagem — POST
      targetUrl = `${META_GRAPH_URL}/${phoneNumberId}/messages`;
      method = 'POST';
    }

    const res = await fetch(targetUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' ? body : undefined,
    });

    const responseBody = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': res.headers.get('content-type') || 'application/json',
      },
      body: responseBody,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: `Proxy error: ${message}` }),
    };
  }
};

export { handler };
