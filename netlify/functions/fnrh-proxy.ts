// netlify/functions/fnrh-proxy.ts
// Proxy server-side para API FNRH Gov (SERPRO) — mantém credenciais no servidor

import type { Handler, HandlerEvent } from '@netlify/functions';

const FNRH_URLS: Record<string, string> = {
  producao:    'https://fnrh.turismo.serpro.gov.br/FNRH_API/rest/v2',
  homologacao: 'https://hom-lowcode.serpro.gov.br/FNRH_API/rest/v2',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'x-fnrh-usuario',
    'x-fnrh-senha',
    'x-fnrh-cpf',
    'x-fnrh-ambiente',
    'x-fnrh-path',
    'x-fnrh-method',
  ].join(', '),
};

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const headers = Object.fromEntries(
    Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  const usuario   = headers['x-fnrh-usuario'];
  const senha     = headers['x-fnrh-senha'];
  const cpf       = headers['x-fnrh-cpf'];
  const ambiente  = headers['x-fnrh-ambiente'] || 'producao';
  const fnrhPath  = headers['x-fnrh-path'];
  const fnrhMethod = headers['x-fnrh-method'] || event.httpMethod;

  if (!usuario || !senha) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Credenciais ausentes (x-fnrh-usuario/senha)' }),
    };
  }

  if (!fnrhPath) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Caminho ausente (x-fnrh-path)' }),
    };
  }

  const baseUrl = FNRH_URLS[ambiente] || FNRH_URLS.producao;
  const targetUrl = `${baseUrl}${fnrhPath}`;

  // Basic Auth no servidor — nunca exposto ao browser
  const credentials = Buffer.from(`${usuario}:${senha}`).toString('base64');

  try {
    const reqHeaders: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Accept':        'application/json',
      'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // Só envia Content-Type se houver corpo (POST/PUT)
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(fnrhMethod.toUpperCase());
    if (isWrite) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    // cpf_solicitante: obrigatório em endpoints de dados pessoais
    if (cpf) {
      reqHeaders['cpf_solicitante'] = String(cpf);
    }

    // Timeout de 25 segundos para não estourar os 30s do Netlify
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(targetUrl, {
        method: fnrhMethod,
        headers: reqHeaders,
        body: isWrite ? (event.body || undefined) : undefined,
        signal: controller.signal,
      });

      const responseBody = await res.text();
      clearTimeout(timeoutId);

      return {
        statusCode: res.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': res.headers.get('content-type') || 'application/json',
        },
        body: responseBody,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      return {
        statusCode: isTimeout ? 504 : 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: isTimeout 
            ? `O servidor do Governo não respondeu em 25s. URL: ${targetUrl}` 
            : `Erro de rede: ${err.message}`,
          target: targetUrl
        }),
      };
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `FNRH proxy error: ${message}` }),
    };
  }
};

export { handler };
