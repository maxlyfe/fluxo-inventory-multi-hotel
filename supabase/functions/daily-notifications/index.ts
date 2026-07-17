// supabase/functions/daily-notifications/index.ts
// ---------------------------------------------------------------------------
// CRON diário (08:00 Brasília): dispara notificações automáticas confiáveis,
// independentemente de alguém abrir o app.
//   • Aniversários de colaboradores (hoje)
//   • Contratos vencendo (hoje ou em 5 dias) — via employees.experience_end
//     e fallback employee_contracts
//
// Roda com SERVICE ROLE → sem o limite de 403 (envia push para todos os
// usuários inscritos). Cria a notificação in-app (sino) E o push FCM.
//
// Agendamento: pg_cron chama esta função via net.http_post (ver SQL no final
// do arquivo de migração). Idempotente: não duplica notificações no mesmo dia.
//
// Secret necessário: FIREBASE_SERVICE_ACCOUNT (mesmo usado em send-fcm-notification)
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ───────────────────────── FCM (FCM v1 + Service Account) ─────────────────
function getServiceAccount() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurado.");
  return JSON.parse(raw);
}

async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${enc(header)}.${enc(payload)}`;

  const pem = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${unsigned}.${sigB64}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth2 falhou: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sendPush(
  supabaseAdmin: any, accessToken: string, projectId: string,
  userId: string, title: string, body: string, targetPath: string,
): Promise<{ sent: number; failed: number }> {
  const { data: tokens } = await supabaseAdmin
    .from("user_fcm_tokens").select("id, token").eq("user_id", userId);
  if (!tokens || tokens.length === 0) return { sent: 0, failed: 0 };

  let sent = 0, failed = 0;
  for (const t of tokens) {
    const message = {
      token: t.token,
      notification: { title, body },
      android: { priority: "high", notification: { default_sound: true, notification_priority: "PRIORITY_HIGH" } },
      webpush: {
        headers: { Urgency: "high" },
        notification: { title, body, icon: "/icon-192x192.png", badge: "/icon-72x72.png" },
        fcm_options: { link: targetPath || "/" },
      },
      data: { url: targetPath || "/" },
    };
    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ message }) },
      );
      if (res.ok) { sent++; }
      else {
        failed++;
        const err = await res.json().catch(() => ({}));
        const code = err?.error?.details?.[0]?.errorCode || err?.error?.status;
        if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
          await supabaseAdmin.from("user_fcm_tokens").delete().eq("id", t.id);
        }
      }
    } catch { failed++; }
  }
  return { sent, failed };
}

// ───────────────────────── Notificar usuários inscritos ───────────────────
// Busca preferências ativas do tipo + filtro de hotel, cria notificação
// in-app (sino) e dispara push para cada usuário.
async function notifySubscribers(
  ctx: { supabaseAdmin: any; accessToken: string; projectId: string; typeCache: Map<string, string> },
  eventKey: string, hotelId: string | null,
  title: string, message: string, targetPath: string,
  relatedId: string, relatedType: string,
): Promise<{ inApp: number; pushSent: number; pushFailed: number }> {
  const { supabaseAdmin } = ctx;

  // notification_type_id (cache)
  let typeId = ctx.typeCache.get(eventKey);
  if (!typeId) {
    const { data: nt } = await supabaseAdmin
      .from("notification_types").select("id").eq("event_key", eventKey).maybeSingle();
    if (!nt) return { inApp: 0, pushSent: 0, pushFailed: 0 };
    typeId = nt.id;
    ctx.typeCache.set(eventKey, typeId);
  }

  // preferências ativas desse tipo
  const { data: prefs } = await supabaseAdmin
    .from("user_notification_preferences")
    .select("user_id, hotel_id")
    .eq("is_active", true)
    .eq("notification_type_id", typeId);
  if (!prefs || prefs.length === 0) return { inApp: 0, pushSent: 0, pushFailed: 0 };

  // filtro de hotel: pref sem hotel → recebe de todos; com hotel → só do mesmo
  const targets = prefs.filter((p: any) => !p.hotel_id || p.hotel_id === hotelId);

  let inApp = 0, pushSent = 0, pushFailed = 0;
  for (const p of targets) {
    // notificação in-app (sino)
    const { error: insErr } = await supabaseAdmin.from("notifications").insert({
      user_id: p.user_id,
      notification_type_id: typeId,
      title, message,
      target_path: targetPath,
      related_entity_id: relatedId,
      related_entity_type: relatedType,
      hotel_id: hotelId,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (!insErr) inApp++;

    // push FCM
    const r = await sendPush(supabaseAdmin, ctx.accessToken, ctx.projectId, p.user_id, title, message, targetPath);
    pushSent += r.sent; pushFailed += r.failed;
  }
  return { inApp, pushSent, pushFailed };
}

// ───────────────────────── Handlers de evento ─────────────────────────────
async function resolveHotelName(supabaseAdmin: any, cache: Map<string, string>, hotelId: string): Promise<string> {
  if (cache.has(hotelId)) return cache.get(hotelId)!;
  const { data } = await supabaseAdmin.from("hotels").select("name").eq("id", hotelId).maybeSingle();
  const name = data?.name || "Hotel";
  cache.set(hotelId, name);
  return name;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const sa = getServiceAccount();
    const accessToken = await getAccessToken(sa);
    const ctx = { supabaseAdmin, accessToken, projectId: sa.project_id, typeCache: new Map<string, string>() };
    const hotelNameCache = new Map<string, string>();

    const results = { birthdays: 0, contracts: 0, inApp: 0, pushSent: 0, pushFailed: 0 };

    // Datas de referência (timezone Brasília via offset -3h aplicado no servidor UTC)
    const now = new Date();
    const brasilia = new Date(now.getTime() - 3 * 3600 * 1000);
    const todayMonth = brasilia.getUTCMonth() + 1;
    const todayDay = brasilia.getUTCDate();
    const todayYear = brasilia.getUTCFullYear();
    const todayISO = brasilia.toISOString().slice(0, 10);

    // Notificações já criadas hoje (evita duplicatas em re-execuções)
    const { data: existing } = await supabaseAdmin
      .from("notifications")
      .select("related_entity_id, related_entity_type")
      .in("related_entity_type", ["employee_birthday", "contract"])
      .gte("created_at", todayISO + "T00:00:00")
      .lte("created_at", todayISO + "T23:59:59");
    const alreadyDone = new Set((existing || []).map((n: any) => `${n.related_entity_type}:${n.related_entity_id}`));

    // ═══ ANIVERSÁRIOS ═══
    const { data: employees } = await supabaseAdmin
      .from("employees")
      .select("id, name, birth_date, hotel_id")
      .eq("status", "active")
      .not("birth_date", "is", null);

    for (const emp of employees || []) {
      const [by, bm, bd] = emp.birth_date.split("-").map(Number);
      if (bm !== todayMonth || bd !== todayDay) continue;
      if (alreadyDone.has(`employee_birthday:${emp.id}`)) continue;

      const age = todayYear - by;
      const hotel = await resolveHotelName(supabaseAdmin, hotelNameCache, emp.hotel_id);
      const title = `🎂 Aniversário hoje — ${hotel}`;
      const message = `${emp.name} faz ${age} anos hoje! 🎉`;
      const r = await notifySubscribers(
        ctx, "EMPLOYEE_BIRTHDAY", emp.hotel_id, title, message,
        "/personnel-department/beneficios/aniversarios", emp.id, "employee_birthday",
      );
      results.birthdays++;
      results.inApp += r.inApp; results.pushSent += r.pushSent; results.pushFailed += r.pushFailed;
    }

    // ═══ CONTRATOS — fonte principal: employees.experience_end ═══
    // A coluna experience_end é a data real de vencimento preenchida pelo DP.
    const { data: empContracts } = await supabaseAdmin
      .from("employees")
      .select("id, name, experience_end, hotel_id")
      .eq("status", "active")
      .not("experience_end", "is", null);

    const todayMidnight = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay));
    const notifiedEmployees = new Set<string>();

    for (const emp of empContracts || []) {
      if (alreadyDone.has(`contract:${emp.id}`)) continue;
      const end = new Date(emp.experience_end + "T12:00:00Z");
      const diffDays = Math.round((end.getTime() - todayMidnight.getTime()) / 86400000);
      if (diffDays !== 0 && diffDays !== 5) continue;

      notifiedEmployees.add(emp.id);
      const hotel = await resolveHotelName(supabaseAdmin, hotelNameCache, emp.hotel_id);
      const title = diffDays === 0
        ? `🚨 Contrato vence HOJE — ${hotel}`
        : `⏳ Contrato vence em ${diffDays} dias — ${hotel}`;
      const message = diffDays === 0
        ? `O contrato de ${emp.name} vence hoje!`
        : `O contrato de ${emp.name} vence em ${diffDays} dias`;
      const eventKey = diffDays === 0 ? "EXP_CONTRACT_ENDS_TODAY" : "EXP_CONTRACT_ENDING_SOON";

      const r = await notifySubscribers(
        ctx, eventKey, emp.hotel_id, title, message,
        "/personnel-department", emp.id, "contract",
      );
      results.contracts++;
      results.inApp += r.inApp; results.pushSent += r.pushSent; results.pushFailed += r.pushFailed;
    }

    // ═══ CONTRATOS — fallback: employee_contracts (contratos manuais) ═══
    const { data: manualContracts } = await supabaseAdmin
      .from("employee_contracts")
      .select("id, employee_name, start_date, hotel_id")
      .eq("is_active", true);

    for (const c of manualContracts || []) {
      if (alreadyDone.has(`contract:${c.id}`)) continue;
      const start = new Date(c.start_date + "T12:00:00Z");
      const endDates = [
        new Date(start.getTime() + 29 * 86400000),
        new Date(start.getTime() + 89 * 86400000),
      ];
      for (const end of endDates) {
        const diffDays = Math.round((end.getTime() - todayMidnight.getTime()) / 86400000);
        if (diffDays !== 0 && diffDays !== 5) continue;

        const hotel = await resolveHotelName(supabaseAdmin, hotelNameCache, c.hotel_id);
        const title = diffDays === 0
          ? `🚨 Contrato vence HOJE — ${hotel}`
          : `⏳ Contrato vence em ${diffDays} dias — ${hotel}`;
        const message = diffDays === 0
          ? `O contrato de experiência de ${c.employee_name} vence hoje!`
          : `O contrato de experiência de ${c.employee_name} vence em ${diffDays} dias`;
        const eventKey = diffDays === 0 ? "EXP_CONTRACT_ENDS_TODAY" : "EXP_CONTRACT_ENDING_SOON";

        const r = await notifySubscribers(
          ctx, eventKey, c.hotel_id, title, message,
          "/personnel-department", c.id, "contract",
        );
        results.contracts++;
        results.inApp += r.inApp; results.pushSent += r.pushSent; results.pushFailed += r.pushFailed;
        break;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("[daily-notifications] erro:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
