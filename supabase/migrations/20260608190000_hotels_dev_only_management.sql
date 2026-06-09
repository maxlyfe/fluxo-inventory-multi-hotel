-- ============================================================================
-- Gestão de hotéis (criar / ativar-desativar / excluir) = SOMENTE DEV
-- ============================================================================
-- Admin opera os hotéis ATIVOS do seu grupo, mas NÃO mexe no cadastro de
-- unidades. Apenas o 'dev' vende/adiciona, oculta/reativa ou exclui unidades.
--
-- 'dev' = profiles.role = 'dev'  OU  custom_role com nome 'dev'.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- (Idempotente — pode rodar mesmo se as migrações anteriores já foram aplicadas.)
-- ============================================================================

-- 1. "É dev?" — redefine para SÓ dev (antes incluía admin/is_system)
CREATE OR REPLACE FUNCTION can_see_hidden_hotels(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN custom_roles cr ON cr.id = p.custom_role_id
    WHERE p.id = uid AND (p.role = 'dev' OR lower(cr.name) = 'dev')
  );
$$;
GRANT EXECUTE ON FUNCTION can_see_hidden_hotels(UUID) TO authenticated, anon;

-- 2. Garante RLS e recria policies de hotels
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='hotels' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.hotels', pol.policyname);
  END LOOP;
END $$;

-- Leitura: ativos para todos; ocultos só para DEV
CREATE POLICY "hotels_select_auth" ON hotels FOR SELECT TO authenticated
USING (COALESCE(is_active, true) = true OR can_see_hidden_hotels(auth.uid()));

CREATE POLICY "hotels_select_anon" ON hotels FOR SELECT TO anon
USING (COALESCE(is_active, true) = true);

-- Criar / excluir hotel: SOMENTE DEV
CREATE POLICY "hotels_insert" ON hotels FOR INSERT TO authenticated
  WITH CHECK (can_see_hidden_hotels(auth.uid()));
CREATE POLICY "hotels_delete" ON hotels FOR DELETE TO authenticated
  USING (can_see_hidden_hotels(auth.uid()));

-- Editar: admin pode editar dados do hotel ativo (nome, endereço, fiscal…),
-- MAS a coluna is_active é protegida por trigger (só dev liga/desliga).
CREATE POLICY "hotels_update" ON hotels FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- 3. Trigger: só dev pode mudar is_active (ativar/desativar)
CREATE OR REPLACE FUNCTION protect_hotel_is_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NOT can_see_hidden_hotels(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o dev pode ativar ou desativar hotéis.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_hotel_is_active ON hotels;
CREATE TRIGGER trg_protect_hotel_is_active
  BEFORE UPDATE ON hotels
  FOR EACH ROW EXECUTE FUNCTION protect_hotel_is_active();

-- ============================================================================
-- TESTE:
--  • Logado como ADMIN (não dev): NÃO vê hotéis ocultos; tentar mudar
--    is_active via API deve falhar; não consegue inserir/excluir hotel.
--  • Logado como DEV: vê todos, cria, oculta/reativa e exclui normalmente.
-- ============================================================================
