-- ============================================================================
-- Login por username (sem obrigatoriedade de e-mail)
-- ============================================================================
-- Permite criar usuários com apenas username+senha. Quando não há email real,
-- o sistema gera um email sintético (<username>.<group_short>@internal.local)
-- para satisfazer o Supabase Auth.
--
-- O username é único DENTRO do grupo (dois grupos podem ter "admin").
-- ============================================================================

-- ── 1. Índice: trocar unicidade global por unicidade por grupo ──────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_group
  ON profiles (lower(username), group_id)
  WHERE username IS NOT NULL;

-- ── 2. RPC: resolver username → email para login ───────────────────────────
-- O frontend chama esta função ANTES de autenticar, passando o username e o
-- group_id (já resolvido pelo slug). Retorna o email (real ou sintético)
-- para usar no signInWithPassword.
CREATE OR REPLACE FUNCTION resolve_username_email(p_username TEXT, p_group_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.email
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(p_username)
    AND p.group_id = p_group_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_username_email(TEXT, UUID) TO authenticated, anon;

-- ── 3. Atualizar RPC get_all_users_with_profile para retornar username ──────
DROP FUNCTION IF EXISTS get_all_users_with_profile();
CREATE OR REPLACE FUNCTION get_all_users_with_profile()
RETURNS TABLE(
  id UUID, email TEXT, role TEXT, custom_role_id UUID, custom_role_name TEXT,
  last_sign_in_at TIMESTAMPTZ, raw_user_meta_data JSONB, created_at TIMESTAMPTZ,
  banned_until TIMESTAMPTZ, group_id UUID, group_name TEXT,
  photo_url TEXT, username TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $$
DECLARE
  caller_is_dev boolean;
  caller_group  uuid;
BEGIN
  caller_is_dev := is_dev_user(auth.uid());
  SELECT p.group_id INTO caller_group FROM public.profiles p WHERE p.id = auth.uid();

  RETURN QUERY
  SELECT
    au.id,
    au.email::text,
    COALESCE(p.role, au.raw_user_meta_data->>'role', 'guest') AS role,
    p.custom_role_id,
    cr.name AS custom_role_name,
    au.last_sign_in_at,
    au.raw_user_meta_data,
    au.created_at,
    au.banned_until,
    p.group_id,
    g.name AS group_name,
    p.photo_url,
    p.username
  FROM auth.users au
  LEFT JOIN public.profiles p     ON p.id = au.id
  LEFT JOIN public.custom_roles cr ON cr.id = p.custom_role_id
  LEFT JOIN public.groups g        ON g.id = p.group_id
  WHERE au.deleted_at IS NULL
    AND (caller_is_dev OR p.group_id = caller_group)
  ORDER BY au.created_at DESC;
END;
$$;
