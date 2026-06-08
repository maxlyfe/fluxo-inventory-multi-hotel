// supabase/functions/send-fcm-notification/index.ts
// Envia push notifications via FCM v1 API (OAuth2 + Service Account)
// A API legada (Server Key) foi descontinuada em junho/2024.
//
// ⚠️ Esta é a versão EM PRODUÇÃO (fiel ao deployado). Tabela de tokens:
//    user_fcm_tokens (coluna `token`). Já envia o bloco "notification",
//    o que faz o Android exibir a notificação com o app fechado.
//
// NOTA sobre automações (aniversário/contrato): a verificação de permissão
// abaixo bloqueia (403) o envio para OUTRO usuário quando quem dispara não é
// admin. Para automações dispararem push para todos, ver send-fcm-broadcast
// ou disparar via service role.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// Service Account — lido da variável de ambiente FIREBASE_SERVICE_ACCOUNT
// Para configurar: Supabase Dashboard → Edge Functions → Secrets
// Nome do secret: FIREBASE_SERVICE_ACCOUNT
// Valor: conteúdo completo do JSON da service account
// ---------------------------------------------------------------------------
function getServiceAccount() {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurado nos secrets da Edge Function.');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Gera JWT para autenticação OAuth2 com a API FCM v1
// ---------------------------------------------------------------------------
async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  // Importa a chave privada RSA
  const pemBody = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${unsignedToken}.${sigBase64}`;

  // Troca o JWT pelo access token OAuth2
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Falha ao obter access token OAuth2: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ---------------------------------------------------------------------------
// Envia uma mensagem FCM para um token específico
// ---------------------------------------------------------------------------
async function sendFcmMessage(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const message: any = {
    token: fcmToken,
    notification: { title, body },
    // Android: prioridade alta garante entrega/exibição com o app fechado
    android: {
      priority: 'high',
      notification: {
        default_sound: true,
        notification_priority: 'PRIORITY_HIGH',
      },
    },
    webpush: {
      headers: { Urgency: 'high' },
      notification: {
        title,
        body,
        icon: '/icon-192x192.png',
        badge: '/icon-72x72.png',
        click_action: '/',
      },
      fcm_options: { link: (data?.url || data?.targetPath || '/') },
    },
  };

  if (data && Object.keys(data).length > 0) {
    message.data = data;
  }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );

  const result = await res.json();

  if (!res.ok) {
    const errCode = result?.error?.details?.[0]?.errorCode || result?.error?.status;
    return { success: false, error: errCode || result?.error?.message || 'Erro FCM desconhecido' };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Autenticar chamador
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Authorization header ausente.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: 'Token inválido.' }, 401);

    // 2. Verificar se é admin ou o próprio usuário enviando para si
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();

    // 3. Parsear payload
    const body = await req.json();
    const { target_user_id, title, body: msgBody, data } = body;

    if (!target_user_id || !title || !msgBody) {
      return json({ error: 'Campos obrigatórios: target_user_id, title, body.' }, 400);
    }

    // Só admin pode enviar para outros usuários
    if (target_user_id !== user.id && callerProfile?.role !== 'admin') {
      return json({ error: 'Sem permissão para enviar notificação para este usuário.' }, 403);
    }

    // 4. Buscar tokens FCM do usuário alvo
    const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('user_fcm_tokens')
      .select('id, token')
      .eq('user_id', target_user_id);

    if (tokensErr) throw tokensErr;
    if (!tokens || tokens.length === 0) {
      return json({ message: 'Nenhum dispositivo registrado para este usuário.', sent: 0 });
    }

    // 5. Obter access token OAuth2
    const serviceAccount = getServiceAccount();
    const accessToken = await getAccessToken(serviceAccount);

    // 6. Enviar para todos os dispositivos do usuário
    const results = await Promise.all(
      tokens.map(async (t) => {
        const result = await sendFcmMessage(
          accessToken,
          serviceAccount.project_id,
          t.token,
          title,
          msgBody,
          data
        );

        // Remove tokens inválidos automaticamente
        if (!result.success && (
          result.error === 'UNREGISTERED' ||
          result.error === 'INVALID_ARGUMENT'
        )) {
          await supabaseAdmin.from('user_fcm_tokens').delete().eq('id', t.id);
          console.log(`Token inválido removido: ${t.id}`);
        }

        return { token_id: t.id, ...result };
      })
    );

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return json({ success: true, sent, failed, results });

  } catch (err: any) {
    console.error('send-fcm-notification error:', err);
    return json({ error: err.message || 'Erro interno.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
