-- ============================================================================
-- Flag para o usuário dispensar o lembrete de vincular CPF
-- ============================================================================
-- Usado pelo pop-up que incentiva novos usuários a informar o CPF (para
-- auto-vínculo com o cadastro do DP). Usuários genéricos (ex: dashboard da
-- cozinha) podem marcar "não notificar novamente".
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cpf_prompt_dismissed BOOLEAN DEFAULT false;
