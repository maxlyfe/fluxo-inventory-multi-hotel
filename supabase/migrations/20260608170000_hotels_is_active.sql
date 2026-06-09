-- ============================================================================
-- Ocultar/reativar hotéis (soft hide) — preserva o histórico
-- ============================================================================
-- Hotel oculto (is_active = false) não aparece para usuários comuns nem pode
-- ser selecionado; o histórico permanece intacto. O 'dev' vê todos e pode
-- reativar. Exclusão definitiva é uma ação separada (DELETE) na UI.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

ALTER TABLE hotels ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Garante que hotéis existentes fiquem ativos
UPDATE hotels SET is_active = true WHERE is_active IS NULL;
