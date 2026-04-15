-- =====================================================
-- FASE 1: Adequação de Produtos (Fiscal + Unidades)
-- =====================================================

-- 1. Novos campos fiscais e de unidade em products
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_measure TEXT DEFAULT 'und';
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'consumo';
ALTER TABLE products ADD COLUMN IF NOT EXISTS mcu_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_percentage NUMERIC(5,2) DEFAULT 0;

-- Constraint para product_type
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_type'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT chk_product_type CHECK (product_type IN ('controle', 'consumo'));
  END IF;
END $$;

-- 2. Conversão de colunas INTEGER → NUMERIC em sector_stock_balance (se ainda INTEGER)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sector_stock_balance'
      AND column_name = 'previous_quantity'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE sector_stock_balance
      ALTER COLUMN previous_quantity TYPE NUMERIC USING previous_quantity::NUMERIC,
      ALTER COLUMN current_quantity TYPE NUMERIC USING current_quantity::NUMERIC,
      ALTER COLUMN received_quantity TYPE NUMERIC USING received_quantity::NUMERIC;
  END IF;
END $$;

-- consumed_quantity é GENERATED — precisa drop + re-add se existir como INTEGER
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sector_stock_balance'
      AND column_name = 'consumed_quantity'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE sector_stock_balance DROP COLUMN consumed_quantity;
    ALTER TABLE sector_stock_balance ADD COLUMN consumed_quantity NUMERIC GENERATED ALWAYS AS (
      previous_quantity + received_quantity - current_quantity
    ) STORED;
  END IF;
END $$;

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_unit_measure ON products(unit_measure);
