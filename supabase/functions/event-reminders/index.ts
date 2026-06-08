// supabase/functions/event-reminders/index.ts
// ---------------------------------------------------------------------------
// Lembretes de eventos do calendário (/portal/events).
//
// Dois modos:
//   • CRON (a cada 5 min): varre eventos próximos e dispara lembretes nas
//     janelas: 24h antes, manhã do dia (07:00 BRT) e 10 min antes.
//   • CREATED (chamado pelo app ao criar evento com "notificar ao criar"):
//     notifica os participantes imediatamente. Valida que o chamador é o
//     criador do evento (via JWT).
//
// Participantes resolvidos dinamicamente pela RPC event_participant_ids.
// Idempotente: event_reminders_sent(event_id, kind) com UNIQUE evita repetir.
//
// Secret: FIREBASE_SERVICE_ACCOUNT (mesmo das outras functions).
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// ───────────── FCM (FCM v1 + Service Account) ─────────────
function getServiceAccount() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurado.");
  return JSON.parse(raw);
}
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })}`;
  const pem = sa.private_key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sigB64}` }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth2 falhou: ${JSON.stringify(data)}`);
  return data.access_token;
}
async function sendPush(admin: any, accessToken: string, projectId: string, userId: string, title: string, body: string, link: string) {
  const { data: tokens } = await admin.from("user_fcm_tokens").select("id, token").eq("user_id", userId);
  for (const t of tokens ?? []) {
    const message = {
      token: t.token,
      notification: { title, body },
      android: { priority: "high", notification: { default_sound: true, notification_priority: "PRIORITY_HIGH" } },
      webpush: { headers: { Urgency: "high" }, notification: { title, body, icon: "/icon-192x192.png" }, fcm_options: { link } },
      data: { url: link },
    };
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const code = err?.error?.details?.[0]?.errorCode || err?.error?.status;
        if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT") await admin.from("user_fcm_tokens").delete().eq("id", t.id);
      }
    } catch { /* ignore */ }
  }
}

// ───────────── Notificar participantes de um evento ─────────────
let cachedTypeId: string | null = null;
async function eventTypeId(admin: any): Promise<string | null> {
  if (cachedTypeId) return cachedTypeId;
  const { data } = await admin.from("notification_types").select("id").eq("event_key", "EVENT_REMINDER").maybeSingle();
  cachedTypeId = data?.id ?? null;
  return cachedTypeId;
}

async function notifyEvent(
  admin: any, accessToken: string, projectId: string,
  ev: any, kind: string, title: string, body: string,
): Promise<number> {
  // Idempotência: tenta registrar o envio ANTES. Se já existe (conflito), pula.
  const { error: insErr } = await admin
    .from("event_reminders_sent")
    .insert({ event_id: ev.id, kind });
  if (insErr) return 0; // já enviado (unique) ou erro — não duplica

  const { data: parts } = await admin.rpc("event_participant_ids", { p_event_id: ev.id });
  let userIds: string[] = [...new Set((parts ?? []).map((p: any) => p.user_id).filter(Boolean))];
  if (userIds.length === 0) return 0;

  // Remove quem recusou o convite — não recebe lembretes
  const { data: declined } = await admin
    .from("event_invitations")
    .select("user_id")
    .eq("event_id", ev.id)
    .eq("status", "declined");
  if (declined && declined.length > 0) {
    const declinedSet = new Set(declined.map((d: any) => d.user_id));
    userIds = userIds.filter((uid) => !declinedSet.has(uid));
  }
  if (userIds.length === 0) return 0;

  const typeId = await eventTypeId(admin);
  const link = "/portal/events";
  let sent = 0;
  for (const uid of userIds) {
    await admin.from("notifications").insert({
      user_id: uid,
      notification_type_id: typeId,
      title, message: body,
      target_path: link,
      related_entity_id: ev.id,
      related_entity_type: "event",
      hotel_id: ev.hotel_id,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await sendPush(admin, accessToken, projectId, uid, title, body, link);
    sent++;
  }
  return sent;
}

// ───────────── Formatação ─────────────
function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}
function buildMsg(ev: any, prefix: string): string {
  const parts = [fmtTime(ev.event_time), ev.location].filter(Boolean);
  return parts.length ? `${prefix}${parts.join(" · ")}` : prefix.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const sa = getServiceAccount();
    const accessToken = await getAccessToken(sa);
    const projectId = sa.project_id;

    // ── Modo CREATED: notificação imediata ao criar (chamado pelo app) ──────
    if (body?.mode === "created" && body?.event_id) {
      const authHeader = req.headers.get("Authorization") || "";
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      const { data: ev } = await admin.from("events").select("*").eq("id", body.event_id).maybeSingle();
      if (!ev) return json({ error: "Evento não encontrado." }, 404);
      // Só o criador (ou service role) pode disparar a notificação de criação
      if (user && ev.created_by && user.id !== ev.created_by) {
        return json({ error: "Sem permissão." }, 403);
      }
      const title = `📅 Novo evento: ${ev.title}`;
      const dateBr = ev.event_date ? ev.event_date.split("-").reverse().join("/") : "";
      const msg = buildMsg(ev, `${dateBr} `);
      const n = await notifyEvent(admin, accessToken, projectId, ev, "created", title, msg);
      return json({ ok: true, notified: n });
    }

    // ── Modo CRON: varre eventos e dispara lembretes ────────────────────────
    const today = new Date();
    const brt = new Date(today.getTime() - 3 * 3600 * 1000);
    const fromDate = brt.toISOString().slice(0, 10);
    const toDate = new Date(brt.getTime() + 2 * 86400000).toISOString().slice(0, 10); // hoje..+2 dias

    const { data: events } = await admin
      .from("events")
      .select("*")
      .gte("event_date", fromDate)
      .lte("event_date", toDate);

    const now = new Date();
    let totalSent = 0;

    for (const ev of events ?? []) {
      const hasTime = !!ev.event_time;
      const startBrt = new Date(`${ev.event_date}T${hasTime ? ev.event_time.slice(0, 5) : "23:59"}:00-03:00`);
      const morningBrt = new Date(`${ev.event_date}T07:00:00-03:00`);

      if (now >= startBrt) continue; // evento já começou/passou

      // Manhã do dia (07:00 BRT)
      if (now >= morningBrt) {
        const title = `📅 Hoje: ${ev.title}`;
        totalSent += await notifyEvent(admin, accessToken, projectId, ev, "morning", title, buildMsg(ev, ""));
      }

      if (hasTime) {
        // 24h antes
        const t24 = new Date(startBrt.getTime() - 24 * 3600 * 1000);
        if (now >= t24) {
          const title = `📅 Amanhã: ${ev.title}`;
          totalSent += await notifyEvent(admin, accessToken, projectId, ev, "24h", title, buildMsg(ev, ""));
        }
        // ~1 hora antes (casa com o cron horário; antes era "10 min antes")
        const t1h = new Date(startBrt.getTime() - 60 * 60 * 1000);
        if (now >= t1h) {
          const title = `⏰ Em breve: ${ev.title}`;
          totalSent += await notifyEvent(admin, accessToken, projectId, ev, "1h", title, buildMsg(ev, ""));
        }
      }
    }

    return json({ ok: true, sent: totalSent, scanned: events?.length ?? 0 });
  } catch (err: any) {
    console.error("[event-reminders] erro:", err.message);
    return json({ error: err.message }, 500);
  }
});

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
