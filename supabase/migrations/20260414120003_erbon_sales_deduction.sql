-- =====================================================
-- FASE 4: Baixa Automática via Erbon PDV
-- =====================================================

CREATE TABLE IF NOT EXISTS erbon_sales_processed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  erbon_service_id INT NOT NULL,
  erbon_department TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  dish_id UUID REFERENCES dishes(id) ON DELETE SET NULL,
  deduction_type TEXT NOT NULL DEFAULT 'direct' CHECK (deduction_type IN ('direct', 'decomposed')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_by TEXT,
  CONSTRAINT chk_deduction_target CHECK (product_id IS NOT NULL OR dish_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erbon_sales_unique
  ON erbon_sales_processed (hotel_id, transaction_date, erbon_service_id, erbon_department);
CREATE INDEX IF NOT EXISTS idx_erbon_sales_hotel_date
  ON erbon_sales_processed (hotel_id, transaction_date);

ALTER TABLE erbon_product_mappings ADD COLUMN IF NOT EXISTS dish_id UUID REFERENCES dishes(id) ON DELETE SET NULL;
ALTER TABLE erbon_product_mappings ALTER COLUMN product_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_mapping_target'
  ) THEN
    ALTER TABLE erbon_product_mappings
      ADD CONSTRAINT chk_mapping_target CHECK (product_id IS NOT NULL OR dish_id IS NOT NULL);
  END IF;
END $$;

ALTER TABLE erbon_sales_processed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read erbon_sales_processed"
  ON erbon_sales_processed FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert erbon_sales_processed"
  ON erbon_sales_processed FOR INSERT TO authenticated WITH CHECK (true);
