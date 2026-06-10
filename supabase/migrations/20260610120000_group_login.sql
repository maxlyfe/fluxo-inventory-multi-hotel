-- ============================================================================
-- Login por grupo: resolve um grupo pelo slug (página pública /grupo/<slug>)
-- ============================================================================
-- A página de login do grupo é pública (anon). O RLS de `groups` bloqueia anon,
-- então usamos uma RPC SECURITY DEFINER que devolve só dados públicos do grupo
-- (id, name, slug) quando o grupo existe e está ativo.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_group_by_slug(p_slug TEXT)
RETURNS TABLE(id UUID, name TEXT, slug TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT g.id, g.name, g.slug
  FROM groups g
  WHERE lower(g.slug) = lower(p_slug)
    AND COALESCE(g.is_active, true) = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_group_by_slug(TEXT) TO anon, authenticated;

-- Conferir:
--   SELECT * FROM get_group_by_slug('meridiana');
-- ============================================================================
