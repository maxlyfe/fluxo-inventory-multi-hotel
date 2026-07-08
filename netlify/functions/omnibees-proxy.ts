// netlify/functions/omnibees-proxy.ts
// Proxy server-side para o Pull WebService da Omnibees (SOAP/OTA 2014B).
// Evita CORS no browser e restringe o destino a domínios omnibees.com.

import type { Handler, HandlerEvent } from '@netlify/functions';

const DEFAULT_URL = 'https://pms.omnibees.com/OTA2014B/PullWebService.asmx';

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, SOAPAction, x-omnibees-url, soapaction',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const targetUrl = event.headers['x-omnibees-url'] || DEFAULT_URL;

  // SEGURANÇA: só domínios oficiais da Omnibees (anti-SSRF)
  try {
    const parsed = new URL(targetUrl);
    if (!parsed.hostname.endsWith('omnibees.com')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: Target domain not allowed' }) };
    }
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid x-omnibees-url' }) };
  }

  const soapAction = event.headers['soapaction'] || event.headers['SOAPAction'] || '';

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction,
      },
      body: event.body || '',
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': res.headers.get('content-type') || 'text/xml',
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
