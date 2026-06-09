-- ============================================================================
-- /users escopado por grupo: o admin só vê usuários do PRÓPRIO grupo.
-- O dev vê todos. Acrescenta group_id / group_name ao retorno.
-- ============================================================================
-- Recria a RPC get_all_users_with_profile com filtro por grupo do chamador.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_all_users_with_profile();

CREATE OR REPLACE FUNCTION public.get_all_users_with_profile()
 RETURNS TABLE(
   id uuid, email text, role text, custom_role_id uuid, custom_role_name text,
   last_sign_in_at timestamptz, raw_user_meta_data jsonb, created_at timestamptz,
   banned_until timestamptz, group_id uuid, group_name text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    g.name AS group_name
  FROM auth.users au
  LEFT JOIN public.profiles p     ON p.id = au.id
  LEFT JOIN public.custom_roles cr ON cr.id = p.custom_role_id
  LEFT JOIN public.groups g        ON g.id = p.group_id
  WHERE au.deleted_at IS NULL
    AND (caller_is_dev OR p.group_id = caller_group)
  ORDER BY au.created_at DESC;
END;
$function$;
-- ============================================================================
