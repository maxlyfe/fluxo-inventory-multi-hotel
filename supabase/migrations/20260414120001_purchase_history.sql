-- =====================================================
-- FASE 2: Histórico de Compras Editável
-- =====================================================

-- 1. Tabela de auditoria para edições de compras
CREATE TABLE IF NOT EXISTS purchase_edit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  purchase_item_id UUID REFERENCES purchase_items(id) ON DELETE SET NULL,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_edit_logs_purchase ON purchase_edit_logs(purchase_id);

-- RLS
ALTER TABLE purchase_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read purchase_edit_logs"
  ON purchase_edit_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert purchase_edit_logs"
  ON purchase_edit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2. RPC para recalcular impacto de uma compra editada
CREATE OR REPLACE FUNCTION recalculate_purchase_impact(p_purchase_id UUID)
RETURNS VOID AS $$
DECLARE
  v_product_id UUID;
  v_new_avg NUMERIC;
  v_last_price NUMERIC;
  v_last_date DATE;
BEGIN
  FOR v_product_id IN
    SELECT DISTINCT pi.product_id
    FROM purchase_items pi
    WHERE pi.purchase_id = p_purchase_id
      AND pi.product_id IS NOT NULL
  LOOP
    SELECT AVG(pi.unit_price)
    INTO v_new_avg
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE pi.product_id = v_product_id;

    SELECT pi.unit_price, p.purchase_date
    INTO v_last_price, v_last_date
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE pi.product_id = v_product_id
    ORDER BY p.purchase_date DESC, p.created_at DESC
    LIMIT 1;

    UPDATE products
    SET average_price = COALESCE(v_new_avg, 0),
        last_purchase_price = v_last_price,
        last_purchase_date = v_last_date
    WHERE id = v_product_id;

    UPDATE ingredients
    SET price_per_unit = COALESCE(v_new_avg, 0)
    WHERE product_id = v_product_id;
  END LOOP;

  UPDATE purchases
  SET total_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  )
  WHERE id = p_purchase_id;
END;
$$ LANGUAGE plpgsql;
