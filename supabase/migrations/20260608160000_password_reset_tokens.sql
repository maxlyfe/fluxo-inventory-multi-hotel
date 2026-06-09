-- ============================================================================
-- Links temporários de redefinição de senha (gerados por admin em /users)
-- ============================================================================
-- Um admin gera um link de 5 minutos para um usuário que está SEM acesso.
-- O usuário abre o link (sem login), define a nova senha e salva.
-- Toda a aplicação da senha é feita pela Edge Function `password-reset`
-- com service role (o front nunca tem privilégio de admin de auth).
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Apenas a Edge Function (service role) acessa. Nada para authenticated/anon.
DROP POLICY IF EXISTS "prt_service_all" ON password_reset_tokens;
CREATE POLICY "prt_service_all" ON password_reset_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);
-- ============================================================================
