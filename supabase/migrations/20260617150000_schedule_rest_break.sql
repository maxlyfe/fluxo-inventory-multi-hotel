-- ============================================================================
-- ESCALA: HORÁRIO DE DESCANSO (ALMOÇO / JANTAR)
-- ============================================================================
-- Permite definir, ao montar a escala, a janela de descanso de cada colaborador
-- por dia. Fontes de pré-preenchimento: padrão do colaborador e padrão do tipo
-- de ocorrência (configurado em "gerenciar tipos").
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- Descanso do dia (na entrada da escala)
ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS rest_start TIME,
  ADD COLUMN IF NOT EXISTS rest_end   TIME;

-- Descanso padrão do colaborador (pré-preenche o auto-preencher / turno)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS default_rest_start TIME,
  ADD COLUMN IF NOT EXISTS default_rest_end   TIME;

-- Descanso padrão por TIPO de ocorrência (configurável em "gerenciar tipos")
ALTER TABLE occurrence_types
  ADD COLUMN IF NOT EXISTS has_rest   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rest_start TIME,
  ADD COLUMN IF NOT EXISTS rest_end   TIME;

-- ============================================================================
