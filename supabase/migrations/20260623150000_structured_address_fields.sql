-- ============================================================================
-- ENDEREÇO ESTRUTURADO: employees + candidates
-- ============================================================================
-- Adiciona campos de endereço separados (CEP, rua, número, bairro, cidade, UF)
-- para padronizar o cadastro em todo o sistema.
--
-- O campo `address` (texto livre) é mantido para retrocompatibilidade.
--
-- IDEMPOTENTE. Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- 1. Employees: campos de endereço estruturado
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_cep          TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_street       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_number       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_neighborhood TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_city         TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_state        TEXT;

-- 2. Candidates: campos adicionais (já tem city, neighborhood, address)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cep            TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_number TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS state          TEXT;

-- ============================================================================
