-- =============================================================================
-- Sistema de Porcionamento: tabela, trigger fix, RPC, auto-porcionamento
-- =============================================================================

-- 1. Tabela pending_portioning_entries
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_portioning_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_delivered numeric NOT NULL,
  purchase_cost numeric DEFAULT 0,
  requisition_id uuid REFERENCES requisitions(id) ON DELETE SET NULL,
  processed boolean DEFAULT false,
  delivered_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_pending_portioning_hotel_sector
  ON pending_portioning_entries (hotel_id, sector_id)
  WHERE processed = false;

CREATE INDEX IF NOT EXISTS idx_pending_portioning_product
  ON pending_portioning_entries (product_id);

-- RLS
ALTER TABLE pending_portioning_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pending entries for their hotel"
  ON pending_portioning_entries FOR SELECT
  USING (true);

CREATE POLICY "Users can insert pending entries"
  ON pending_portioning_entries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update pending entries"
  ON pending_portioning_entries FOR UPDATE
  USING (true);

-- 2. Campos de auto-porcionamento no produto
-- -----------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS auto_portion_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_portion_multiplier numeric;

COMMENT ON COLUMN products.auto_portion_product_id IS 'Produto porção resultante para auto-porcionamento (ex: Arroz kg → Arroz g)';
COMMENT ON COLUMN products.auto_portion_multiplier IS 'Fator de conversão (ex: 1000 para kg→g). Qty enviada * multiplier = qty porção';

-- 3. Corrigir trigger: NÃO adicionar itens porcionáveis ao sector_stock
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_sector_requisition_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_is_portionable boolean;
  v_actual_product_id uuid;
BEGIN
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    v_actual_product_id := COALESCE(NEW.substituted_product_id, NEW.product_id);

    -- Verificar se produto é porcionável
    SELECT COALESCE(is_portionable, false) INTO v_is_portionable
    FROM products WHERE id = v_actual_product_id;

    -- Só adiciona ao sector_stock se NÃO for porcionável
    IF NOT COALESCE(v_is_portionable, false) THEN
      INSERT INTO sector_stock (sector_id, product_id, quantity, hotel_id)
      VALUES (
        NEW.sector_id,
        v_actual_product_id,
        COALESCE(NEW.delivered_quantity, NEW.quantity),
        NEW.hotel_id
      )
      ON CONFLICT (sector_id, product_id, hotel_id)
      DO UPDATE SET
        quantity = sector_stock.quantity + COALESCE(NEW.delivered_quantity, NEW.quantity),
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Processar porcionamento manual (carne, peixe, etc.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_multi_portioning(
  p_pending_entry_id uuid,
  p_portioned_items jsonb,   -- [{product_id, product_name, yield_quantity}]
  p_loss_amount numeric,
  p_hotel_id uuid,
  p_sector_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_yield numeric;
  v_entry record;
BEGIN
  -- Buscar entrada pendente
  SELECT * INTO v_entry FROM pending_portioning_entries
  WHERE id = p_pending_entry_id AND processed = false;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Entrada não encontrada ou já processada');
  END IF;

  -- Remover item pai do sector_stock (caso exista por bug anterior do trigger)
  UPDATE sector_stock
  SET quantity = quantity - v_entry.quantity_delivered, updated_at = now()
  WHERE sector_id = p_sector_id
    AND product_id = v_entry.product_id
    AND hotel_id = p_hotel_id;

  -- Limpar registros com quantidade <= 0
  DELETE FROM sector_stock
  WHERE sector_id = p_sector_id
    AND product_id = v_entry.product_id
    AND hotel_id = p_hotel_id
    AND quantity <= 0;

  -- Inserir cada item porção no sector_stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_portioned_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_yield := (v_item->>'yield_quantity')::numeric;

    INSERT INTO sector_stock (sector_id, product_id, quantity, hotel_id)
    VALUES (p_sector_id, v_product_id, v_yield, p_hotel_id)
    ON CONFLICT (sector_id, product_id, hotel_id)
    DO UPDATE SET
      quantity = sector_stock.quantity + v_yield,
      updated_at = now();
  END LOOP;

  -- Marcar como processado
  UPDATE pending_portioning_entries
  SET processed = true, processed_at = now(), processed_by = p_user_id
  WHERE id = p_pending_entry_id;

  RETURN jsonb_build_object('success', true, 'message', 'Porcionamento concluído com sucesso');
END;
$$;

-- 5. RPC: Auto-porcionamento (chamado pelo AdminPanel na entrega)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_auto_portioning(
  p_hotel_id uuid,
  p_sector_id uuid,
  p_parent_product_id uuid,
  p_quantity_delivered numeric,
  p_purchase_cost numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_auto_product_id uuid;
  v_multiplier numeric;
  v_portion_qty numeric;
BEGIN
  -- Buscar configuração de auto-porcionamento
  SELECT auto_portion_product_id, auto_portion_multiplier
  INTO v_auto_product_id, v_multiplier
  FROM products
  WHERE id = p_parent_product_id;

  IF v_auto_product_id IS NULL OR v_multiplier IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Produto sem auto-porcionamento configurado');
  END IF;

  v_portion_qty := p_quantity_delivered * v_multiplier;

  -- Inserir item porção no sector_stock
  INSERT INTO sector_stock (sector_id, product_id, quantity, hotel_id)
  VALUES (p_sector_id, v_auto_product_id, v_portion_qty, p_hotel_id)
  ON CONFLICT (sector_id, product_id, hotel_id)
  DO UPDATE SET
    quantity = sector_stock.quantity + v_portion_qty,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Auto-porcionamento: %s → %s unidades', p_quantity_delivered, v_portion_qty),
    'portion_quantity', v_portion_qty
  );
END;
$$;

COMMENT ON FUNCTION process_multi_portioning IS 'Processa porcionamento manual: remove pai, adiciona porções ao sector_stock';
COMMENT ON FUNCTION process_auto_portioning IS 'Processa auto-porcionamento: converte e adiciona porção ao sector_stock automaticamente';
