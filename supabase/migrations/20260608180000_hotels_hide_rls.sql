-- ============================================================================
-- Esconde hotéis ocultos (is_active=false) de TODO o sistema, via RLS.
-- ============================================================================
-- Em vez de filtrar is_active em cada tela (frágil), o próprio Postgres passa
-- a não retornar hotéis ocultos para usuários comuns — em qualquer query,
-- seletor, join ou tela (atual ou futura). Apenas admin/dev (donos do sistema)
-- continuam vendo os ocultos, para poder reativá-los em /select-hotel.
--
-- Edge Functions e RPCs (service role / SECURITY DEFINER) seguem vendo tudo.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- Função: o usuário é admin/dev do sistema? (vê hotéis ocultos)
CREATE OR REPLACE FUNCTION can_see_hidden_hotels(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN custom_roles cr ON cr.id = p.custom_role_id
    WHERE p.id = uid AND (
      p.role IN ('admin', 'dev')
      OR cr.is_system = true
    )
  );
$$;

-- Garante RLS ligado
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;

-- Remove todas as policies atuais de hotels e recria de forma controlada
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hotels' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.hotels', pol.policyname);
  END LOOP;
END $$;

-- Leitura (autenticado): hotéis ativos para todos; ocultos só para admin/dev
CREATE POLICY "hotels_select_auth" ON hotels FOR SELECT TO authenticated
USING (
  COALESCE(is_active, true) = true
  OR can_see_hidden_hotels(auth.uid())
);

-- Leitura (público / sem login — ex.: web check-in, seleção pública): só ativos
CREATE POLICY "hotels_select_anon" ON hotels FOR SELECT TO anon
USING (COALESCE(is_active, true) = true);

-- Escrita (padrão do projeto: permissivo para authenticated)
CREATE POLICY "hotels_insert" ON hotels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "hotels_update" ON hotels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hotels_delete" ON hotels FOR DELETE TO authenticated USING (true);

GRANT EXECUTE ON FUNCTION can_see_hidden_hotels(UUID) TO authenticated, anon;

-- ============================================================================
-- TESTE: logado como usuário COMUM, esta query não deve trazer os ocultos.
--   SELECT id, name, is_active FROM hotels ORDER BY name;
-- Logado como dev/admin, deve trazer todos.
-- ============================================================================
