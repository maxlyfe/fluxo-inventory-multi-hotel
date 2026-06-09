// supabase/functions/password-reset/index.ts
// ---------------------------------------------------------------------------
// Links temporários de redefinição de senha (5 minutos).
//
//   • generate (admin, com JWT): cria um token de 5 min para um usuário e
//     devolve o token. O app monta o link /reset-password/<token>.
//   • validate (público): confere se o token é válido (existe, não usado,
//     não expirado) e devolve o e-mail mascarado para a tela.
//   • apply (público): define a nova senha do usuário (via service role) e
//     marca o token como usado.
//
// Deploy SEM verificação de JWT (a credencial do modo público é o token):
//   npx supabase functions deploy password-reset --no-verify-jwt --project-ref bnmyflgyrlskhljrbyfc
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

const TTL_MINUTES = 5;

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!d) return email;
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode;

    // ── GENERATE (admin) ────────────────────────────────────────────────
    if (mode === "generate") {
      const authHeader = req.headers.get("Authorization") || "";
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Não autenticado." }, 401);

      // Verifica se é admin do sistema (igual à send-fcm-notification)
      const { data: prof } = await admin.from("profiles").select("role, custom_role_id").eq("id", user.id).maybeSingle();
      let isAdmin = prof?.role === "admin" || prof?.role === "dev";
      if (!isAdmin && prof?.custom_role_id) {
        const { data: role } = await admin.from("custom_roles").select("is_system, permissions").eq("id", prof.custom_role_id).maybeSingle();
        const perms: string[] = role?.permissions ?? [];
        isAdmin = role?.is_system === true || perms.includes("users_management") || perms.includes("admin");
      }
      if (!isAdmin) return json({ error: "Sem permissão." }, 403);

      const targetUserId = body?.target_user_id;
      if (!targetUserId) return json({ error: "target_user_id obrigatório." }, 400);

      // Invalida tokens anteriores não usados desse usuário (opcional, higiene)
      await admin.from("password_reset_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("user_id", targetUserId).is("used_at", null);

      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
      const { error: insErr } = await admin.from("password_reset_tokens").insert({
        user_id: targetUserId, token, expires_at: expiresAt, created_by: user.id,
      });
      if (insErr) return json({ error: insErr.message }, 500);

      return json({ token, expires_at: expiresAt, ttl_minutes: TTL_MINUTES });
    }

    // ── VALIDATE (público) ──────────────────────────────────────────────
    if (mode === "validate") {
      const token = body?.token;
      if (!token) return json({ valid: false, reason: "missing" });
      const { data: row } = await admin.from("password_reset_tokens").select("*").eq("token", token).maybeSingle();
      if (!row) return json({ valid: false, reason: "not_found" });
      if (row.used_at) return json({ valid: false, reason: "used" });
      if (new Date(row.expires_at) < new Date()) return json({ valid: false, reason: "expired" });

      // Busca e-mail do usuário (mascarado) só para exibição
      const { data: u } = await admin.auth.admin.getUserById(row.user_id);
      return json({ valid: true, email: u?.user?.email ? maskEmail(u.user.email) : null });
    }

    // ── APPLY (público) ─────────────────────────────────────────────────
    if (mode === "apply") {
      const token = body?.token;
      const password = body?.password;
      if (!token || !password) return json({ error: "Token e senha obrigatórios." }, 400);
      if (String(password).length < 6) return json({ error: "A senha deve ter ao menos 6 caracteres." }, 400);

      const { data: row } = await admin.from("password_reset_tokens").select("*").eq("token", token).maybeSingle();
      if (!row) return json({ error: "Link inválido." }, 400);
      if (row.used_at) return json({ error: "Este link já foi usado." }, 400);
      if (new Date(row.expires_at) < new Date()) return json({ error: "Link expirado." }, 400);

      const { error: updErr } = await admin.auth.admin.updateUserById(row.user_id, { password });
      if (updErr) return json({ error: updErr.message }, 500);

      await admin.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      return json({ ok: true });
    }

    return json({ error: "Modo inválido." }, 400);
  } catch (err: any) {
    console.error("[password-reset] erro:", err.message);
    return json({ error: err.message }, 500);
  }
});
