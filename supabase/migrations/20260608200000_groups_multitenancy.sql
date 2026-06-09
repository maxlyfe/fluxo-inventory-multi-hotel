-- ============================================================================
-- Multi-tenancy por GRUPOS hoteleiros — Fase 1 (fundação)
-- ============================================================================
-- Cada grupo tem seus hotéis e seus usuários. Um usuário pertence a 1 grupo e
-- recebe acesso a hotéis individualmente (user_hotel_access). O 'dev' (dono do
-- SaaS) gerencia grupos e atribui hotéis. Admin do grupo vê todos os hotéis
-- ativos do seu grupo; usuário comum vê só os hotéis concedidos.
--
-- Isolamento (lean): a visibilidade de HOTÉIS é controlada por RLS; como tudo
-- já é scopado por hotel_id, o usuário só opera os hotéis que enxerga.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── 1. Tabelas e colunas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE hotels   ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);

CREATE TABLE IF NOT EXISTS user_hotel_access (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, hotel_id)
);
CREATE INDEX IF NOT EXISTS idx_uha_user  ON user_hotel_access(user_id);
CREATE INDEX IF NOT EXISTS idx_uha_hotel ON user_hotel_access(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotels_group   ON hotels(group_id);
CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id);

-- ── 2. Migração dos dados atuais para um grupo padrão ───────────────────────
INSERT INTO groups (name, slug)
SELECT 'LyFe Hoteles', 'lyfe'
WHERE NOT EXISTS (SELECT 1 FROM groups);

-- Vincula hotéis e perfis existentes ao grupo padrão (o mais antigo)
UPDATE hotels   SET group_id = (SELECT id FROM groups ORDER BY created_at LIMIT 1) WHERE group_id IS NULL;
UPDATE profiles SET group_id = (SELECT id FROM groups ORDER BY created_at LIMIT 1) WHERE group_id IS NULL;

-- Preserva o acesso atual ("todos viam tudo"): cada usuário ganha acesso a
-- todos os hotéis do seu grupo. (A partir de agora, novos hotéis exigem
-- concessão explícita pelo admin.)
INSERT INTO user_hotel_access (user_id, hotel_id)
SELECT p.id, h.id
FROM profiles p
JOIN hotels h ON h.group_id = p.group_id
ON CONFLICT (user_id, hotel_id) DO NOTHING;

-- ── 3. Funções auxiliares (SECURITY DEFINER — evitam RLS aninhado) ──────────
-- É dev? (role 'dev' ou custom role chamado 'dev')
CREATE OR REPLACE FUNCTION is_dev_user(uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN custom_roles cr ON cr.id = p.custom_role_id
    WHERE p.id = uid AND (p.role = 'dev' OR lower(cr.name) = 'dev')
  );
$$;

-- Usuário pode acessar o hotel? dev OU (mesmo grupo E (admin do grupo OU acesso concedido))
CREATE OR REPLACE FUNCTION user_can_access_hotel(uid UUID, hid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    is_dev_user(uid)
    OR EXISTS (
      SELECT 1 FROM hotels h JOIN profiles p ON p.id = uid
      WHERE h.id = hid
        AND h.group_id = p.group_id
        AND (
          p.role = 'admin'
          OR EXISTS (SELECT 1 FROM user_hotel_access ua WHERE ua.user_id = uid AND ua.hotel_id = hid)
        )
    );
$$;

-- Ator (admin/dev) pode gerenciar o usuário alvo? (mesmo grupo e admin, ou dev)
CREATE OR REPLACE FUNCTION can_manage_user(actor UUID, target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT is_dev_user(actor)
    OR EXISTS (
      SELECT 1 FROM profiles a JOIN profiles t ON t.id = target
      WHERE a.id = actor AND a.role = 'admin' AND a.group_id = t.group_id
    );
$$;

GRANT EXECUTE ON FUNCTION is_dev_user(UUID)              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION user_can_access_hotel(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION can_manage_user(UUID, UUID)    TO authenticated;
-- Mantém compat com a migração anterior (hotels dev-only): aponta para is_dev_user
CREATE OR REPLACE FUNCTION can_see_hidden_hotels(uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT is_dev_user(uid); $$;

-- ── 4. RLS — groups ─────────────────────────────────────────────────────────
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT TO authenticated
USING (is_dev_user(auth.uid()) OR id = (SELECT group_id FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "groups_write" ON groups;
CREATE POLICY "groups_write" ON groups FOR ALL TO authenticated
USING (is_dev_user(auth.uid())) WITH CHECK (is_dev_user(auth.uid()));

-- ── 5. RLS — user_hotel_access ──────────────────────────────────────────────
ALTER TABLE user_hotel_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uha_select" ON user_hotel_access;
CREATE POLICY "uha_select" ON user_hotel_access FOR SELECT TO authenticated
USING (user_id = auth.uid() OR can_manage_user(auth.uid(), user_id));
DROP POLICY IF EXISTS "uha_insert" ON user_hotel_access;
CREATE POLICY "uha_insert" ON user_hotel_access FOR INSERT TO authenticated
WITH CHECK (can_manage_user(auth.uid(), user_id));
DROP POLICY IF EXISTS "uha_delete" ON user_hotel_access;
CREATE POLICY "uha_delete" ON user_hotel_access FOR DELETE TO authenticated
USING (can_manage_user(auth.uid(), user_id));

-- ── 6. RLS — hotels (recria, incorporando grupo + acesso) ───────────────────
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='hotels' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.hotels', pol.policyname);
  END LOOP;
END $$;

-- Leitura autenticada: dev vê tudo; demais veem hotéis ATIVOS que podem acessar
CREATE POLICY "hotels_select_auth" ON hotels FOR SELECT TO authenticated
USING (
  is_dev_user(auth.uid())
  OR (COALESCE(is_active, true) = true AND user_can_access_hotel(auth.uid(), id))
);
-- Leitura pública (sem login): só ativos (fluxos públicos ainda não são por grupo — Fase 2)
CREATE POLICY "hotels_select_anon" ON hotels FOR SELECT TO anon
USING (COALESCE(is_active, true) = true);
-- Criar / excluir: somente dev
CREATE POLICY "hotels_insert" ON hotels FOR INSERT TO authenticated
WITH CHECK (is_dev_user(auth.uid()));
CREATE POLICY "hotels_delete" ON hotels FOR DELETE TO authenticated
USING (is_dev_user(auth.uid()));
-- Editar: permissivo (admin edita dados do hotel); is_active protegido por trigger
CREATE POLICY "hotels_update" ON hotels FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

-- Trigger que mantém is_active só-dev (recriado para garantir presença)
CREATE OR REPLACE FUNCTION protect_hotel_is_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT is_dev_user(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o dev pode ativar ou desativar hotéis.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_hotel_is_active ON hotels;
CREATE TRIGGER trg_protect_hotel_is_active
  BEFORE UPDATE ON hotels FOR EACH ROW EXECUTE FUNCTION protect_hotel_is_active();

-- ============================================================================
-- TESTE:
--   • Conferir: SELECT count(*) FROM hotels WHERE group_id IS NULL;  -- deve ser 0
--   •           SELECT count(*) FROM profiles WHERE group_id IS NULL; -- deve ser 0
--   • dev cria 2º grupo, hotel nele e usuário; usuário do grupo novo NÃO vê
--     hotéis do grupo "LyFe Hoteles".
-- ============================================================================
