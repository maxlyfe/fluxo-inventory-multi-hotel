// netlify/functions/lib/auth.ts
// Validação de identidade e permissão para as Netlify Functions.
//
// Por que este arquivo existe: nenhuma function do projeto validava JWT. O
// nf-proxy aceita qualquer POST de qualquer origem (CORS '*') e recebe o
// certificado A1 no corpo — é o achado #2 de 06-Seguranca.md. Toda function nova
// nasce validando, e o nf-proxy pode migrar para cá depois.
//
// Uso:
//   const { userId, token } = await requireUser(event);
//   await requireHotelAccess(userId, hotelId);
//   await requirePermission(userId, 'finances.billing.send');

import type { HandlerEvent } from '@netlify/functions';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Erro com status HTTP, para o handler traduzir direto na resposta. */
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * CORS para function autenticada: a origem precisa ser a do site, nunca '*'.
 * Com credencial no header, '*' seria pior do que o que o nf-proxy já faz.
 */
export function corsHeaders(event: HandlerEvent, methods = 'POST, OPTIONS') {
  const siteUrl = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowed = [siteUrl, 'http://localhost:5173', 'http://localhost:8888'].filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : siteUrl || allowed[0] || '',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

export function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new HttpError(500, 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Valida o access_token do Supabase enviado no header Authorization. */
export async function requireUser(event: HandlerEvent): Promise<{ userId: string; token: string }> {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Token de autenticação ausente');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new HttpError(500, 'Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
  }
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Token inválido ou expirado');
  return { userId: data.user.id, token };
}

/** Usa a função já existente no banco (20260608200000) como fonte única. */
export async function requireHotelAccess(userId: string, hotelId: string): Promise<void> {
  if (!hotelId) throw new HttpError(400, 'hotel_id obrigatório');
  const svc = serviceClient();
  // Assinatura real: user_can_access_hotel(uid uuid, hid uuid) — 20260608200000.
  const { data, error } = await svc.rpc('user_can_access_hotel', { uid: userId, hid: hotelId });
  if (error) throw new HttpError(500, `Falha ao verificar acesso ao hotel: ${error.message}`);
  if (data !== true) throw new HttpError(403, 'Sem acesso a este hotel');
}

/**
 * Checa a permissão granular do perfil.
 *
 * Mesma resolução em três níveis do usePermissions no front: dev e admin legado
 * sem custom_role têm bypass; os demais precisam da chave em
 * custom_roles.permissions. Aceita também a chave grossa (ex.: 'finances') para
 * não derrubar perfis que ainda não receberam a granular.
 */
export async function requirePermission(userId: string, key: string, coarseKey?: string): Promise<void> {
  const svc = serviceClient();
  const { data, error } = await svc
    .from('profiles')
    .select('role, custom_role_id, custom_roles(name, permissions)')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `Falha ao carregar perfil: ${error.message}`);
  if (!data) throw new HttpError(403, 'Perfil não encontrado');

  const role = (data as any).role as string | null;
  const custom = (data as any).custom_roles as { name?: string; permissions?: string[] } | null;

  if (role === 'dev' || custom?.name?.toLowerCase() === 'dev') return;
  if (role === 'admin' && !(data as any).custom_role_id) return;

  const perms = custom?.permissions ?? [];
  if (perms.includes(key)) return;
  if (coarseKey && perms.includes(coarseKey)) return;

  throw new HttpError(403, `Permissão necessária: ${key}`);
}

/** Resposta JSON com o CORS correto e o statusCode de um HttpError, se houver. */
export function jsonResponse(event: HandlerEvent, statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function errorResponse(event: HandlerEvent, err: unknown) {
  const status = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'Erro desconhecido';
  if (status >= 500) console.error('[netlify/auth]', message);
  return jsonResponse(event, status, { ok: false, error: message });
}
