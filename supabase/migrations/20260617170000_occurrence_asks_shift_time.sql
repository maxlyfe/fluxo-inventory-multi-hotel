-- ============================================================================
-- TIPOS DE ESCALA: FLAG "PEDE HORÁRIO DE TRABALHO"
-- ============================================================================
-- O horário (de trabalho e de descanso) NÃO é definido na criação do tipo —
-- é informado individualmente ao ATRIBUIR a escala. O tipo só declara, via
-- flags, o que deve ser perguntado:
--   • asks_shift_time → pede horário de trabalho (início–fim) ao atribuir
--   • has_rest        → pede horário de descanso (almoço/jantar) ao atribuir
-- (rest_start/rest_end no tipo deixam de ser usados — o horário é por atribuição.)
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

ALTER TABLE occurrence_types
  ADD COLUMN IF NOT EXISTS asks_shift_time BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
