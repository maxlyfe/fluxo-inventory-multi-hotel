-- ============================================================================
-- Fix: handle_hotel_transfer — destino não recebia estoque transferido
-- ============================================================================
-- BUG: O trigger atual procura o produto no hotel destino comparando nomes
--      com `name = name` (case-sensitive, sensível a espaços e acentos).
--      Qualquer diferença sutil (espaço extra, acento, maiúscula) faz o
--      match falhar e o trigger CRIA UM NOVO PRODUTO no destino com a
--      quantidade transferida, em vez de incrementar o existente.
--
--      Resultado: origem é debitada corretamente, mas o produto "esperado"
--      no destino fica inalterado (porque há um duplicado novo, geralmente
--      invisível na UI se filtros estiverem ativos).
--
-- FIX:
--   1. PRIMEIRO procura em `product_links` (vínculos manuais já configurados
--      pelo usuário em /inventory) — fonte de verdade preferida.
--   2. Se não há vínculo, fallback para match por nome normalizado
--      (LOWER + TRIM) — tolera espaços e diferença de caixa.
--   3. Se nada matchar, cria novo produto no destino (comportamento legado).
--
-- Aplicar via SQL Editor no Supabase Dashboard.
-- ============================================================================

DROP TRIGGER IF EXISTS handle_hotel_transfer ON hotel_transfers;
DROP FUNCTION IF EXISTS handle_hotel_transfer();

CREATE OR REPLACE FUNCTION handle_hotel_transfer()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id     uuid;
  v_source_name    text;
  v_quantity       integer;
  v_current_stock  integer;
  v_unit_cost      decimal(10,2);
  v_total_cost     decimal(10,2);
BEGIN
  -- Só processa quando transferência muda de pending → completed
  IF NEW.status = 'completed' AND OLD.status = 'pending' THEN

    -- ── Pega estoque e custo do produto origem (com lock) ─────────────────
    SELECT quantity, COALESCE(average_price, last_purchase_price, 0), name
    INTO   v_current_stock, v_unit_cost, v_source_name
    FROM products
    WHERE id = NEW.product_id
      AND hotel_id = NEW.source_hotel_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado no hotel de origem';
    END IF;

    IF v_current_stock < NEW.quantity THEN
      RAISE EXCEPTION 'Quantidade insuficiente em estoque (disponível: %, necessário: %)',
        v_current_stock, NEW.quantity;
    END IF;

    v_total_cost := NEW.quantity * v_unit_cost;

    -- ── Debita do produto origem ──────────────────────────────────────────
    UPDATE products
    SET quantity = quantity - NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id
      AND hotel_id = NEW.source_hotel_id
      AND quantity >= NEW.quantity;

    -- ── Movimento de saída no origem ──────────────────────────────────────
    INSERT INTO inventory_movements (
      product_id, quantity_change, movement_type, reason,
      performed_by, hotel_id, unit_cost
    ) VALUES (
      NEW.product_id, -NEW.quantity, 'saida',
      'Transferência entre hotéis (saída)',
      current_user, NEW.source_hotel_id, v_unit_cost
    );

    -- ── Acha o produto correspondente no destino ──────────────────────────
    --
    -- ESTRATÉGIA 1: vínculo manual em product_links (fonte preferida)
    SELECT CASE
      WHEN pl.product_a_id = NEW.product_id THEN pl.product_b_id
      ELSE pl.product_a_id
    END
    INTO v_product_id
    FROM product_links pl
    JOIN products p ON p.id = CASE
      WHEN pl.product_a_id = NEW.product_id THEN pl.product_b_id
      ELSE pl.product_a_id
    END
    WHERE (pl.product_a_id = NEW.product_id OR pl.product_b_id = NEW.product_id)
      AND p.hotel_id = NEW.destination_hotel_id
    LIMIT 1;

    -- ESTRATÉGIA 2: match por nome normalizado (LOWER + TRIM)
    IF v_product_id IS NULL THEN
      SELECT id INTO v_product_id
      FROM products
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_source_name))
        AND hotel_id = NEW.destination_hotel_id
      LIMIT 1;
    END IF;

    -- ESTRATÉGIA 3 (último recurso): cria novo produto no destino
    IF v_product_id IS NULL THEN
      INSERT INTO products (
        name, category, quantity, min_quantity, max_quantity,
        supplier, image_url, description, hotel_id,
        last_purchase_price, average_price, created_at, updated_at
      )
      SELECT
        name, category, NEW.quantity, min_quantity, max_quantity,
        supplier, image_url, description, NEW.destination_hotel_id,
        v_unit_cost, v_unit_cost, now(), now()
      FROM products
      WHERE id = NEW.product_id
      RETURNING id INTO v_product_id;
    ELSE
      -- Produto existe (via link ou nome): incrementa quantidade + custo médio
      UPDATE products
      SET quantity = quantity + NEW.quantity,
          last_purchase_price = v_unit_cost,
          average_price = (
            COALESCE(average_price, 0) * COALESCE(quantity, 0) + v_total_cost
          ) / NULLIF(COALESCE(quantity, 0) + NEW.quantity, 0),
          updated_at = now()
      WHERE id = v_product_id;
    END IF;

    -- ── Movimento de entrada no destino ───────────────────────────────────
    INSERT INTO inventory_movements (
      product_id, quantity_change, movement_type, reason,
      performed_by, hotel_id, unit_cost
    ) VALUES (
      v_product_id, NEW.quantity, 'entrada',
      'Transferência entre hotéis (entrada)',
      current_user, NEW.destination_hotel_id, v_unit_cost
    );

    -- ── Marca transferência com custo e timestamp ─────────────────────────
    NEW.unit_cost    = v_unit_cost;
    NEW.completed_at = now();

    -- ── Registra movimentação financeira ──────────────────────────────────
    PERFORM record_transfer_cost(NEW.id, v_unit_cost);
  END IF;

  RETURN NEW;

EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'Produto está sendo atualizado por outra operação. Tente novamente.';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in handle_hotel_transfer for transfer %: %', NEW.id, SQLERRM;
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER handle_hotel_transfer
  BEFORE UPDATE ON hotel_transfers
  FOR EACH ROW
  EXECUTE FUNCTION handle_hotel_transfer();

COMMENT ON FUNCTION handle_hotel_transfer() IS
  'Transferência entre hotéis: usa product_links (vínculo manual) → fallback nome normalizado → fallback cria novo. Atualiza estoque, custo médio, movimentos e financeiro.';
