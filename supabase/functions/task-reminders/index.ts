// supabase/functions/task-reminders/index.ts
// ---------------------------------------------------------------------------
// Lembretes de tarefas do Todo List (/portal/tasks).
//
// Modo CRON (agendar 1x por hora no Dashboard):
//   1. Re-materializa as ocorrências das tarefas recorrentes ativas
//      (generate_task_occurrences — janela rolante de 60 dias).
//   2. Varre ocorrências pendentes próximas e dispara lembretes nas janelas:
//      24h antes (com horário), manhã do dia (07:00 BRT) e 1h antes.
//
// Destinatários: criador + assignees que aceitaram ou estão pendentes
// (task_participant_ids). Quem recusou não recebe. Quem já concluiu a
// ocorrência (task_completions) também não recebe.
//
// Idempotente: task_reminders_sent(occurrence_id, user_id, kind) UNIQUE.
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

// ───────────── Tipo de notificação TASK_DUE ─────────────
let cachedTypeId: string | null = null;
async function taskDueTypeId(admin: any): Promise<string | null> {
  if (cachedTypeId) return cachedTypeId;
  const { data } = await admin.from("notification_types").select("id").eq("event_key", "TASK_DUE").maybeSingle();
  cachedTypeId = data?.id ?? null;
  return cachedTypeId;
}

// ───────────── Notificar participantes de uma ocorrência ─────────────
async function notifyOccurrence(
  admin: any, accessToken: string, projectId: string,
  occ: any, task: any, kind: string, title: string, body: string,
): Promise<number> {
  // Participantes: criador + assignees não recusados
  const { data: parts } = await admin.rpc("task_participant_ids", { p_task_id: task.id });
  let userIds: string[] = [...new Set((parts ?? []).map((p: any) => p.user_id).filter(Boolean))];
  if (userIds.length === 0) return 0;

  // Quem já concluiu esta ocorrência não recebe lembrete
  const { data: completions } = await admin
    .from("task_completions")
    .select("user_id")
    .eq("occurrence_id", occ.id);
  const doneSet = new Set((completions ?? []).map((c: any) => c.user_id));
  userIds = userIds.filter((uid) => !doneSet.has(uid));
  if (userIds.length === 0) return 0;

  const typeId = await taskDueTypeId(admin);
  const link = "/portal/tasks";
  let sent = 0;

  for (const uid of userIds) {
    // Idempotência POR USUÁRIO: registra antes; conflito = já enviado
    const { error: insErr } = await admin
      .from("task_reminders_sent")
      .insert({ occurrence_id: occ.id, user_id: uid, kind });
    if (insErr) continue;

    await admin.from("notifications").insert({
      user_id: uid,
      notification_type_id: typeId,
      title, message: body,
      target_path: link,
      related_entity_id: occ.id,
      related_entity_type: "task_occurrence",
      hotel_id: task.hotel_id,
      is_read: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await sendPush(admin, accessToken, projectId, uid, title, body, link);
    sent++;
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const sa = getServiceAccount();
    const accessToken = await getAccessToken(sa);
    const projectId = sa.project_id;

    // ── 1. Re-materializar janela rolante das tarefas recorrentes ativas ───
    let regenerated = 0;
    const { data: recurringTasks } = await admin
      .from("tasks")
      .select("id")
      .eq("is_active", true)
      .neq("recurrence_freq", "none");
    for (const t of recurringTasks ?? []) {
      const { error } = await admin.rpc("generate_task_occurrences", { p_task_id: t.id });
      if (!error) regenerated++;
    }

    // ── 2. Lembretes: ocorrências pendentes de hoje até +2 dias ────────────
    const nowUtc = new Date();
    const brt = new Date(nowUtc.getTime() - 3 * 3600 * 1000);
    const fromDate = brt.toISOString().slice(0, 10);
    const toDate = new Date(brt.getTime() + 2 * 86400000).toISOString().slice(0, 10);

    const { data: occs } = await admin
      .from("task_occurrences")
      .select("*, tasks!inner(id, title, hotel_id, is_active, created_by)")
      .eq("status", "pending")
      .eq("tasks.is_active", true)
      .gte("due_date", fromDate)
      .lte("due_date", toDate);

    const now = new Date();
    let totalSent = 0;

    for (const occ of occs ?? []) {
      const task = occ.tasks;
      const hasTime = !!occ.due_time;
      const startBrt = new Date(`${occ.due_date}T${hasTime ? occ.due_time.slice(0, 5) : "23:59"}:00-03:00`);
      const morningBrt = new Date(`${occ.due_date}T07:00:00-03:00`);
      const time = hasTime ? ` às ${occ.due_time.slice(0, 5)}` : "";

      // Manhã do dia (07:00 BRT) — sempre, mesmo sem horário
      if (now >= morningBrt && now < startBrt) {
        totalSent += await notifyOccurrence(admin, accessToken, projectId, occ, task,
          "morning", `✅ Tarefa hoje: ${task.title}`, `Vence hoje${time}`);
      }

      if (hasTime) {
        // 24h antes
        const t24 = new Date(startBrt.getTime() - 24 * 3600 * 1000);
        if (now >= t24 && now < startBrt) {
          totalSent += await notifyOccurrence(admin, accessToken, projectId, occ, task,
            "24h", `✅ Tarefa amanhã: ${task.title}`, `Vence${time}`);
        }
        // 1h antes
        const t1h = new Date(startBrt.getTime() - 3600 * 1000);
        if (now >= t1h && now < startBrt) {
          totalSent += await notifyOccurrence(admin, accessToken, projectId, occ, task,
            "1h", `⏰ Tarefa em breve: ${task.title}`, `Vence${time}`);
        }
      }
    }

    return json({ ok: true, sent: totalSent, scanned: occs?.length ?? 0, regenerated });
  } catch (err: any) {
    console.error("[task-reminders] erro:", err.message);
    return json({ error: err.message }, 500);
  }
});

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
