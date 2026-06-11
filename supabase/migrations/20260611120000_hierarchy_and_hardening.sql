-- ============================================================================
-- HIERARQUIA DE PERFIS + HARDENING DE SEGURANÇA (multi-tenant)
-- ============================================================================
-- Modelo de hierarquia:
--   • dev (dono do SaaS)            = nível 0 (implícito — não se cadastra)
--   • dentro de cada grupo: nível 1 = mais alto (ex: Diretor), 2, 3, ... ∞
--   • vários perfis podem ter o MESMO nível
--   • um usuário só GERENCIA usuários de nível ESTRITAMENTE MAIOR (mais baixo)
--     que o seu, do MESMO grupo. Nível 1 só é gerenciado pelo dev.
--   • um usuário só cria/edita/atribui PERFIS de nível maior que o seu.
--   • perfil sem nível (NULL) = sem poder de gestão (tratado como nível 9999).
--
-- Hardening incluído:
--   1. profiles: role / custom_role_id / group_id protegidos por trigger
--      (anti escalada de privilégio e troca de grupo via API).
--   2. hotels: UPDATE escopado ao próprio grupo; group_id só dev (trigger).
--   3. hotel_transfers: origem e destino DEVEM ser do mesmo grupo (trigger).
--   4. custom_roles: escrita governada pela hierarquia.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── 1. Coluna de hierarquia ─────────────────────────────────────────────────
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS hierarchy_level INT;

-- Perfil "dev" legado (se existir) fica nível 0 por clareza
UPDATE custom_roles SET hierarchy_level = 0 WHERE lower(name) = 'dev' AND hierarchy_level IS NULL;

-- ── 2. Nível efetivo de um usuário ──────────────────────────────────────────
-- dev → 0 | admin legado (role='admin' sem custom_role) → 1 |
-- custom_role.hierarchy_level | sem nível → 9999 (sem poder de gestão)
CREATE OR REPLACE FUNCTION user_hierarchy_level(uid UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN is_dev_user(uid) THEN 0
    ELSE COALESCE(
      (SELECT cr.hierarchy_level FROM profiles p JOIN custom_roles cr ON cr.id = p.custom_role_id WHERE p.id = uid),
      (SELECT CASE WHEN p.role = 'admin' AND p.custom_role_id IS NULL THEN 1 END FROM profiles p WHERE p.id = uid),
      9999
    )
  END;
$$;
GRANT EXECUTE ON FUNCTION user_hierarchy_level(UUID) TO authenticated;

-- ── 3. can_manage_user — agora por hierarquia + mesmo grupo ─────────────────
CREATE OR REPLACE FUNCTION can_manage_user(actor UUID, target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT is_dev_user(actor)
    OR (
      -- mesmo grupo E nível do ator estritamente mais alto (número menor)
      EXISTS (
        SELECT 1 FROM profiles a JOIN profiles t ON t.id = target
        WHERE a.id = actor AND a.group_id IS NOT NULL AND a.group_id = t.group_id
      )
      AND user_hierarchy_level(actor) < user_hierarchy_level(target)
      AND user_hierarchy_level(actor) < 9999
    );
$$;
GRANT EXECUTE ON FUNCTION can_manage_user(UUID, UUID) TO authenticated;

-- Ator pode mexer em (criar/editar/excluir/atribuir) um perfil deste nível?
-- Regra: só perfis de nível ESTRITAMENTE maior que o seu (dev mexe em todos).
CREATE OR REPLACE FUNCTION can_manage_role_level(actor UUID, lvl INT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT is_dev_user(actor)
    OR (user_hierarchy_level(actor) < COALESCE(lvl, 9999)
        AND user_hierarchy_level(actor) < 9999);
$$;
GRANT EXECUTE ON FUNCTION can_manage_role_level(UUID, INT) TO authenticated;

-- ── 4. TRIGGER — profiles: anti escalada de privilégio / troca de grupo ─────
-- role, custom_role_id e group_id só mudam se:
--   • contexto service role (edge functions/cron: auth.uid() IS NULL), OU
--   • ator é dev, OU
--   • ator pode gerenciar o alvo (hierarquia+grupo) E o novo perfil atribuído
--     é de nível estritamente maior que o do ator (ninguém promove ao próprio nível).
CREATE OR REPLACE FUNCTION protect_profiles_sensitive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  actor UUID := auth.uid();
  new_role_level INT;
BEGIN
  -- Sem mudança sensível → segue
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.custom_role_id IS NOT DISTINCT FROM OLD.custom_role_id
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id THEN
    RETURN NEW;
  END IF;

  -- Service role (edge functions / crons) → permitido (já validam o chamador)
  IF actor IS NULL THEN RETURN NEW; END IF;

  -- Dev → permitido
  IF is_dev_user(actor) THEN RETURN NEW; END IF;

  -- group_id NUNCA muda por não-dev (nem o próprio admin se move de grupo)
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'Apenas o dev pode mover usuários entre grupos.';
  END IF;

  -- Auto-alteração de role/perfil → bloqueada (anti auto-promoção)
  IF actor = NEW.id THEN
    RAISE EXCEPTION 'Você não pode alterar o próprio perfil de acesso.';
  END IF;

  -- Precisa poder gerenciar o alvo
  IF NOT can_manage_user(actor, NEW.id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o perfil deste usuário.';
  END IF;

  -- O perfil atribuído deve ser de nível mais baixo que o do ator
  IF NEW.custom_role_id IS DISTINCT FROM OLD.custom_role_id AND NEW.custom_role_id IS NOT NULL THEN
    SELECT hierarchy_level INTO new_role_level FROM custom_roles WHERE id = NEW.custom_role_id;
    IF NOT can_manage_role_level(actor, new_role_level) THEN
      RAISE EXCEPTION 'Você não pode atribuir um perfil de nível igual ou superior ao seu.';
    END IF;
  END IF;

  -- role nativo: não-dev nunca concede 'dev'; 'admin' exige nível 1
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role = 'dev' THEN
      RAISE EXCEPTION 'Apenas o dev pode conceder o papel dev.';
    END IF;
    IF NEW.role = 'admin' AND user_hierarchy_level(actor) > 1 THEN
      RAISE EXCEPTION 'Apenas nível 1 (ou dev) pode conceder papel admin.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_profiles_sensitive ON profiles;
CREATE TRIGGER trg_protect_profiles_sensitive
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profiles_sensitive();

-- ── 5. hotels: UPDATE escopado ao grupo + group_id só dev ───────────────────
DROP POLICY IF EXISTS "hotels_update" ON hotels;
CREATE POLICY "hotels_update" ON hotels FOR UPDATE TO authenticated
USING (
  is_dev_user(auth.uid())
  OR group_id = (SELECT group_id FROM profiles WHERE id = auth.uid())
)
WITH CHECK (
  is_dev_user(auth.uid())
  OR group_id = (SELECT group_id FROM profiles WHERE id = auth.uid())
);

CREATE OR REPLACE FUNCTION protect_hotel_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id
     AND auth.uid() IS NOT NULL
     AND NOT is_dev_user(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o dev pode mover hotéis entre grupos.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_hotel_group ON hotels;
CREATE TRIGGER trg_protect_hotel_group
  BEFORE UPDATE ON hotels
  FOR EACH ROW EXECUTE FUNCTION protect_hotel_group();

-- ── 6. hotel_transfers: NUNCA cruza grupos (trava no banco) ─────────────────
CREATE OR REPLACE FUNCTION protect_transfer_same_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  g_src UUID; g_dst UUID;
BEGIN
  SELECT group_id INTO g_src FROM hotels WHERE id = NEW.source_hotel_id;
  SELECT group_id INTO g_dst FROM hotels WHERE id = NEW.destination_hotel_id;
  IF g_src IS DISTINCT FROM g_dst THEN
    RAISE EXCEPTION 'Transferência bloqueada: os hotéis pertencem a grupos diferentes.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_transfer_same_group ON hotel_transfers;
CREATE TRIGGER trg_transfer_same_group
  BEFORE INSERT OR UPDATE ON hotel_transfers
  FOR EACH ROW EXECUTE FUNCTION protect_transfer_same_group();

-- ── 7. custom_roles: escrita governada pela hierarquia ──────────────────────
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='custom_roles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.custom_roles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "roles_select" ON custom_roles FOR SELECT TO authenticated USING (true);

-- Criar: só perfis de nível mais baixo que o do ator (e ator com poder de gestão)
CREATE POLICY "roles_insert" ON custom_roles FOR INSERT TO authenticated
WITH CHECK (can_manage_role_level(auth.uid(), hierarchy_level));

-- Editar: o ator precisa poder gerir tanto o nível atual quanto o novo
CREATE POLICY "roles_update" ON custom_roles FOR UPDATE TO authenticated
USING (can_manage_role_level(auth.uid(), hierarchy_level))
WITH CHECK (can_manage_role_level(auth.uid(), hierarchy_level));

CREATE POLICY "roles_delete" ON custom_roles FOR DELETE TO authenticated
USING (can_manage_role_level(auth.uid(), hierarchy_level));

-- ============================================================================
-- TESTES RÁPIDOS:
--   SELECT user_hierarchy_level('<uid-dev>');     -- 0
--   SELECT user_hierarchy_level('<uid-admin>');   -- 1 (legado) ou nível do perfil
--   • Usuário comum tentando: UPDATE profiles SET role='dev' WHERE id=auth.uid()
--     → "Você não pode alterar o próprio perfil de acesso."
--   • Transferência com hotéis de grupos diferentes → bloqueada.
-- ============================================================================
