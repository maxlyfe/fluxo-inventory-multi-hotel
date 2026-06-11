// supabase/functions/admin-user-actions/index.ts
// Ações administrativas de usuário (criar, senha, função, ban, signout).
// Multi-tenancy: novo usuário herda o GRUPO do admin que o cria; o dev pode
// escolher o grupo (body.group_id).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Authorization header ausente.' }, 401);

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !caller) return json({ error: 'Token inválido ou expirado.' }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Perfil do chamador (role + grupo)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles').select('role, group_id').eq('id', caller.id).maybeSingle();
    if (profileError) return json({ error: 'Erro ao validar chamador.' }, 500);

    // Autorização por HIERARQUIA: dev (nível 0) ou qualquer nível com poder de
    // gestão (< 9999). Suporta cargos customizados (Diretor, Gerente, etc.).
    const { data: callerLevelData, error: lvlErr } = await supabaseAdmin
      .rpc('user_hierarchy_level', { uid: caller.id });
    const callerLevel: number = lvlErr || callerLevelData == null ? 9999 : Number(callerLevelData);
    const callerIsDev = callerLevel === 0;
    if (callerLevel >= 9999)
      return json({ error: 'Acesso negado. Seu perfil não tem poder de gestão de usuários.' }, 403);

    const callerGroupId = profile?.group_id ?? null;

    const body = await req.json();
    const { action, target_user_id } = body;

    if (!action) return json({ error: 'Campo obrigatório: action.' }, 400);

    const actionsRequiringTarget = ['change_password', 'change_role', 'toggle_ban', 'force_signout'];
    if (actionsRequiringTarget.includes(action)) {
      if (!target_user_id) return json({ error: 'Campo obrigatório: target_user_id.' }, 400);
      if (target_user_id === caller.id)
        return json({ error: 'Não pode aplicar esta ação na própria conta.' }, 400);

      // HARDENING: o alvo precisa ser gerenciável pelo chamador
      // (mesmo grupo + hierarquia superior; dev gerencia todos).
      const { data: canManage } = await supabaseAdmin
        .rpc('can_manage_user', { actor: caller.id, target: target_user_id });
      if (!canManage)
        return json({ error: 'Sem permissão: o usuário alvo não pertence ao seu grupo ou tem nível igual/superior ao seu.' }, 403);
    }

    const validSystemRoles = ['admin', 'dev', 'guest', 'inventory', 'management', 'sup-governanca'];

    // Valida que o chamador pode atribuir este perfil/role (hierarquia):
    //   • custom_role: nível do perfil deve ser MAIOR que o do chamador
    //   • role 'dev': só dev · role 'admin': só nível <= 1
    async function assertCanAssign(customRoleId: string | null | undefined, systemRole: string | null | undefined): Promise<string | null> {
      if (callerIsDev) return null;
      if (systemRole === 'dev') return 'Apenas o dev pode conceder o papel dev.';
      if (systemRole === 'admin' && callerLevel > 1) return 'Apenas nível 1 (ou dev) pode conceder papel admin.';
      if (customRoleId) {
        const { data: r } = await supabaseAdmin
          .from('custom_roles').select('hierarchy_level').eq('id', customRoleId).maybeSingle();
        const lvl = r?.hierarchy_level ?? 9999;
        if (lvl <= callerLevel)
          return 'Você não pode atribuir um perfil de nível igual ou superior ao seu.';
      }
      return null;
    }

    switch (action) {

      case 'create_user': {
        const { email, password, role = 'guest', custom_role_id } = body;
        if (!email || !password) return json({ error: 'Campos obrigatórios: email, password.' }, 400);
        if (password.length < 6) return json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, 400);
        const safeRole = validSystemRoles.includes(role) ? role : 'guest';

        const assignErr = await assertCanAssign(custom_role_id, safeRole);
        if (assignErr) return json({ error: assignErr }, 403);

        // Grupo do novo usuário: dev pode escolher (body.group_id); senão herda o do admin.
        const newGroupId = (callerIsDev && body.group_id) ? body.group_id : callerGroupId;

        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { role: safeRole },
        });
        if (error) throw error;
        if (data.user) {
          await supabaseAdmin.from('profiles').upsert({
            id: data.user.id, role: safeRole,
            custom_role_id: custom_role_id || null,
            group_id: newGroupId,
            updated_at: new Date().toISOString(),
          });
        }
        return json({ success: true, message: `Usuário ${email} criado.`, user: { id: data.user?.id, email } });
      }

      case 'change_password': {
        const { new_password } = body;
        if (!new_password || new_password.length < 6)
          return json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, 400);
        const { error } = await supabaseAdmin.auth.admin.updateUserById(target_user_id, { password: new_password });
        if (error) throw error;
        return json({ success: true, message: 'Senha alterada com sucesso.' });
      }

      case 'change_role': {
        const { new_role, custom_role_id } = body;
        if (!new_role || !validSystemRoles.includes(new_role))
          return json({ error: `Role inválido. Permitidos: ${validSystemRoles.join(', ')}.` }, 400);

        const assignErr = await assertCanAssign(custom_role_id, new_role);
        if (assignErr) return json({ error: assignErr }, 403);
        const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
          id: target_user_id, role: new_role,
          custom_role_id: custom_role_id ?? null,
          updated_at: new Date().toISOString(),
        });
        if (profileErr) throw profileErr;
        await supabaseAdmin.auth.admin.updateUserById(target_user_id, { user_metadata: { role: new_role } });
        return json({ success: true, message: `Função alterada para ${new_role}.` });
      }

      case 'toggle_ban': {
        const { disable } = body;
        const { error } = await supabaseAdmin.auth.admin.updateUserById(target_user_id, {
          ban_duration: disable ? '876600h' : 'none',
        });
        if (error) throw error;
        if (disable) {
          await supabaseAdmin.rpc('admin_force_signout', { target_user: target_user_id });
        }
        return json({ success: true, message: disable ? 'Usuário desabilitado.' : 'Usuário habilitado.', is_disabled: disable });
      }

      case 'force_signout': {
        const { data, error } = await supabaseAdmin.rpc('admin_force_signout', {
          target_user: target_user_id,
        });
        if (error) throw error;
        return json({
          success: true,
          message: `Utilizador desconectado de todos os dispositivos. (${data ?? 0} sessões encerradas)`,
        });
      }

      default:
        return json({ error: `Ação desconhecida: ${action}.` }, 400);
    }

  } catch (err: any) {
    console.error('admin-user-actions error:', err);
    return json({ error: err.message || 'Erro interno do servidor.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
