-- ─────────────────────────────────────────────────────────────────────────────
-- PDV: Lançamento para colaboradores
-- Permite que vendas do PDV sejam direcionadas a funcionários (conta corrente
-- local) além de hóspedes (conta corrente Erbon).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tipo de destino da venda: hóspede ou colaborador
ALTER TABLE pdv_sales
  ADD COLUMN IF NOT EXISTS charge_target TEXT NOT NULL DEFAULT 'guest'
    CHECK (charge_target IN ('guest', 'employee'));

-- 2. Referência ao colaborador (quando charge_target = 'employee')
ALTER TABLE pdv_sales
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE pdv_sales
  ADD COLUMN IF NOT EXISTS employee_name TEXT;

-- 3. Tornar campos de hóspede opcionais (colaborador não tem reserva)
ALTER TABLE pdv_sales
  ALTER COLUMN booking_internal_id DROP NOT NULL;

ALTER TABLE pdv_sales
  ALTER COLUMN booking_number DROP NOT NULL;

ALTER TABLE pdv_sales
  ALTER COLUMN room_description DROP NOT NULL;

ALTER TABLE pdv_sales
  ALTER COLUMN guest_name DROP NOT NULL;

-- 4. Índice para consultas de conta corrente por colaborador
CREATE INDEX IF NOT EXISTS idx_pdv_sales_employee
  ON pdv_sales (hotel_id, employee_id)
  WHERE employee_id IS NOT NULL;
