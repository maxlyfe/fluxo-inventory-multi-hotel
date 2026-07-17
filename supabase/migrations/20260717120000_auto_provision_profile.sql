-- ============================================================================
-- Auto-provisioning de perfil para login Google (e qualquer OAuth)
-- ============================================================================
-- Problema: quando um novo usuário entra via Google OAuth, o Supabase cria a
-- linha em auth.users, mas NENHUM trigger cria o perfil em profiles. Sem perfil
-- (ou com group_id NULL), o GroupLogin bloqueia com "Esta conta não pertence a
-- este grupo."
--
-- Solução: RPC SECURITY DEFINER que o frontend chama logo após o login, se o
-- usuário ainda não tem group_id. Cria o perfil (upsert) com o group_id do
-- grupo da URL de login.
--
-- Segurança:
--   • Só atua se o usuário NÃO tem group_id (impede troca de grupo).
--   • Valida que o grupo existe e está ativo.
--   • SECURITY DEFINER bypassa RLS e o trigger protect_profiles_sensitive.
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_user_profile(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_existing  UUID;
  v_group_ok  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Verifica se o grupo existe e está ativo
  SELECT is_active INTO v_group_ok FROM groups WHERE id = p_group_id;
  IF v_group_ok IS NOT TRUE THEN
    RETURN FALSE;
  END IF;

  -- Verifica se o usuário já tem group_id
  SELECT group_id INTO v_existing FROM profiles WHERE id = v_uid;

  IF v_existing IS NOT NULL THEN
    -- Já tem grupo — não faz nada (impede troca)
    RETURN FALSE;
  END IF;

  -- Upsert: cria o perfil se não existe, ou atualiza group_id se é NULL
  INSERT INTO profiles (id, role, group_id, updated_at)
  VALUES (v_uid, 'guest', p_group_id, now())
  ON CONFLICT (id) DO UPDATE
    SET group_id   = EXCLUDED.group_id,
        updated_at = now()
    WHERE profiles.group_id IS NULL;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_user_profile(UUID) TO authenticated;
