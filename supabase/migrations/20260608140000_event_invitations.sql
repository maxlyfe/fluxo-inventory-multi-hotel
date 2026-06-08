-- ============================================================================
-- Aceite de participação em eventos
-- ============================================================================
-- Um convite NÃO bloqueia a agenda automaticamente. O participante precisa
-- aceitar. Quem recusa para de receber os lembretes daquele evento.
--
-- Sem linha = convite pendente (implícito). Aceitar/recusar cria/atualiza a
-- linha. Eventos próprios (criador) e públicos do hotel não exigem aceite.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'declined'
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_invitations_user  ON event_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_event_invitations_event ON event_invitations(event_id);

ALTER TABLE event_invitations ENABLE ROW LEVEL SECURITY;

-- Cada usuário gerencia apenas as próprias respostas
DROP POLICY IF EXISTS "ei_select_own" ON event_invitations;
CREATE POLICY "ei_select_own" ON event_invitations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ei_insert_own" ON event_invitations;
CREATE POLICY "ei_insert_own" ON event_invitations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ei_update_own" ON event_invitations;
CREATE POLICY "ei_update_own" ON event_invitations FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- service_role (edge functions) lê tudo para excluir quem recusou dos lembretes
DROP POLICY IF EXISTS "ei_service_all" ON event_invitations;
CREATE POLICY "ei_service_all" ON event_invitations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
-- ============================================================================
