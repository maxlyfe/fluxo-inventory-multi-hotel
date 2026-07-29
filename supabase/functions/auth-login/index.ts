// supabase/functions/auth-login/index.ts
// Login por senha com bloqueio por tentativas (3 falhas + 30s).
//
// É o ÚNICO caminho de login por senha do app. O lockout vive no banco
// (migration 20260729120000_login_guard.sql) e é aplicado aqui, com
// service_role — o front não consegue burlar porque não enxerga as funções.
//
// O endpoint /auth/v1/token do Supabase continua público; quem fecha esse
// bypass é o CAPTCHA (Turnstile) em Authentication → Attack Protection.
// Com ele ligado, o captchaToken é obrigatório e chega por este handler.
//
// DEPLOY (sem verify_jwt: é o próprio login, não há JWT ainda):
//   npx supabase functions deploy auth-login --no-verify-jwt --project-ref bnmyflgyrlskhljrbyfc

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Mensagem única para qualquer falha de credencial: não revela se o usuário
// existe, se o username é válido ou se só a senha está errada.
const GENERIC_ERROR = 'Credenciais inválidas.';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const first = fwd.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const ip = clientIp(req);

  try {
    const { group_slug, identifier, password, captchaToken } = await req.json();

    if (!identifier || !password) {
      return json({ error: 'Informe login e senha.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── 1. Resolve o identificador para um e-mail ───────────────────────────
    let email: string = String(identifier).trim();

    if (!email.includes('@')) {
      if (!group_slug) return json({ error: GENERIC_ERROR }, 401);

      const { data: groupData } = await supabaseAdmin
        .rpc('get_group_by_slug', { p_slug: group_slug });
      const group = Array.isArray(groupData) ? groupData[0] : groupData;
      if (!group?.id) return json({ error: GENERIC_ERROR }, 401);

      const { data: resolved } = await supabaseAdmin
        .rpc('resolve_username_email', { p_username: email, p_group_id: group.id });

      // Username inexistente ainda conta como tentativa: senão, o atacante
      // enumera usernames de graça, sem nunca acionar o lockout.
      if (!resolved) {
        const blockedFor = await registerFailure(supabaseAdmin, email, ip);
        return blockedFor > 0
          ? json({ error: tooManyMessage(blockedFor), retry_after: blockedFor }, 429)
          : json({ error: GENERIC_ERROR }, 401);
      }
      email = String(resolved);
    }

    // ── 2. Já está bloqueado? Nem chega no Supabase Auth ────────────────────
    const { data: checkData } = await supabaseAdmin
      .rpc('login_guard_check', { p_email: email, p_ip: ip });
    const check = Array.isArray(checkData) ? checkData[0] : checkData;

    if (check && check.allowed === false) {
      const wait = Number(check.retry_after) || 30;
      return json({ error: tooManyMessage(wait), retry_after: wait }, 429);
    }

    // ── 3. Tentativa real de login ─────────────────────────────────────────
    const supabaseAnon = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    // ── 4. Falhou → contabiliza ────────────────────────────────────────────
    if (authError || !authData?.session) {
      // Erro de captcha não é credencial errada: não penaliza o usuário,
      // e a mensagem precisa ser específica para não confundir suporte.
      const msg = authError?.message ?? '';
      if (/captcha/i.test(msg)) {
        return json({ error: 'Falha na verificação de segurança. Recarregue a página.' }, 400);
      }

      const blockedFor = await registerFailure(supabaseAdmin, email, ip);
      return blockedFor > 0
        ? json({ error: tooManyMessage(blockedFor), retry_after: blockedFor }, 429)
        : json({ error: GENERIC_ERROR }, 401);
    }

    // ── 5. Sucesso → limpa o histórico e devolve a sessão ───────────────────
    await supabaseAdmin.rpc('login_guard_reset', { p_email: email, p_ip: ip });

    return json({
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    });
  } catch (err) {
    console.error('[auth-login]', err);
    return json({ error: 'Erro ao processar o login. Tente novamente.' }, 500);
  }
});

async function registerFailure(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string
): Promise<number> {
  const { data } = await admin.rpc('login_guard_fail', { p_email: email, p_ip: ip });
  return Number(data) || 0;
}

function tooManyMessage(seconds: number): string {
  return `Muitas tentativas. Aguarde ${seconds}s antes de tentar novamente.`;
}
