// supabase/functions/send-fcm-notification/index.ts
// ---------------------------------------------------------------------------
// Envia push notification via FCM HTTP v1 (Service Account) para TODOS os
// dispositivos do usuário (web + Android nativo).
//
// CRÍTICO p/ Android com app fechado: o payload inclui o bloco "notification"
// + "android.notification". Mensagens só-"data" NÃO aparecem na bandeja do
// sistema quando o app está fechado — precisam do bloco "notification".
//
// Secret necessário (Supabase → Edge Functions → Secrets):
//   FIREBASE_SERVICE_ACCOUNT = JSON da service account do projeto Firebase
// ---------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { JWT } from "https://esm.sh/google-auth-library@8.7.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  target_user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { target_user_id, title, body, data }: RequestBody = await req.json();

    if (!target_user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: target_user_id, title, body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // 1. Supabase admin (service role)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 2. Buscar tokens FCM do usuário (web + nativo) na tabela user_devices
    const { data: devices, error: devErr } = await supabaseAdmin
      .from("user_devices")
      .select("fcm_token")
      .eq("user_id", target_user_id)
      .eq("is_active", true)
      .not("fcm_token", "is", null);

    if (devErr) {
      return new Response(
        JSON.stringify({ error: "Erro ao buscar tokens", details: devErr.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const tokens = [...new Set((devices ?? []).map((d: any) => d.fcm_token).filter(Boolean))];
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "Sem dispositivos." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 3. Service Account → access token (FCM v1)
    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
    if (!serviceAccount.project_id) {
      return new Response(
        JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT não configurada." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const accessToken = await jwtClient.getAccessToken();

    // FCM v1 exige todos os valores de "data" como string
    const safeData: Record<string, string> = {};
    if (data) {
      for (const [k, v] of Object.entries(data)) safeData[k] = v == null ? "" : String(v);
    }
    // Garante que o SW web e o clique nativo tenham a URL de destino
    if (!safeData.url && safeData.targetPath) safeData.url = safeData.targetPath;

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    // 4. Enviar para cada token
    for (const token of tokens) {
      const message = {
        token,
        // Bloco notification → Android/iOS mostram automaticamente com app fechado
        notification: { title, body },
        data: safeData,
        android: {
          priority: "HIGH",
          notification: {
            default_sound: true,
            notification_priority: "PRIORITY_HIGH",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
        },
        // Web push (Service Worker) — clique abre a URL
        webpush: {
          notification: { title, body, icon: "/icon-192x192.png" },
          fcm_options: { link: safeData.url || "/" },
        },
      };

      try {
        const resp = await fetch(fcmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken.token}`,
          },
          body: JSON.stringify({ message }),
        });

        if (resp.ok) {
          sent++;
        } else {
          failed++;
          const errBody = await resp.json().catch(() => ({}));
          const fcmErr = errBody?.error?.details?.[0]?.errorCode || errBody?.error?.status || "";
          if (fcmErr === "UNREGISTERED" || fcmErr === "INVALID_ARGUMENT") {
            invalidTokens.push(token);
          }
          console.warn(`[FCM] Falha token ${token.slice(0, 12)}…:`, fcmErr);
        }
      } catch (e) {
        failed++;
        console.error("[FCM] Erro de rede:", (e as Error).message);
      }
    }

    // 5. Limpar tokens inválidos (desativar)
    if (invalidTokens.length > 0) {
      await supabaseAdmin
        .from("user_devices")
        .update({ is_active: false })
        .in("fcm_token", invalidTokens);
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[FCM] Erro geral:", (error as Error).message);
    return new Response(
      JSON.stringify({ error: "Erro interno", details: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
