-- ============================================================================
-- HISTÓRICO DE EQUIPAMENTOS DE MANUTENÇÃO
-- ============================================================================
-- Registra mudanças de status e edições de um equipamento, para acompanhar o
-- ciclo de vida (ex.: ativo → em manutenção → inativo). Cada mudança gera uma
-- linha imutável.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_equipment_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id    UUID NOT NULL REFERENCES maintenance_equipment(id) ON DELETE CASCADE,
  hotel_id        UUID,
  change_type     TEXT NOT NULL DEFAULT 'status',   -- 'status' | 'edit' | 'created'
  old_status      TEXT,
  new_status      TEXT,
  note            TEXT,
  changed_by      UUID,
  changed_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meh_equipment ON maintenance_equipment_history(equipment_id, created_at DESC);

ALTER TABLE maintenance_equipment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meh_select" ON maintenance_equipment_history;
DROP POLICY IF EXISTS "meh_insert" ON maintenance_equipment_history;

-- Leitura/escrita para autenticados (mesma postura das demais tabelas de manutenção).
CREATE POLICY "meh_select" ON maintenance_equipment_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "meh_insert" ON maintenance_equipment_history
  FOR INSERT TO authenticated WITH CHECK (true);
-- Sem UPDATE/DELETE: o histórico é imutável.

-- TESTE: SELECT * FROM maintenance_equipment_history ORDER BY created_at DESC LIMIT 5;
-- ============================================================================
