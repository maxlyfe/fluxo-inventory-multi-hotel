-- ─────────────────────────────────────────────────────────────────────────────
-- Erbon Product Mappings: overrides de mapeamento por departamento
--
-- Permite que o MESMO produto Erbon (ex.: "Milanesa a Parmegiana") seja
-- classificado como PRODUTO (NFC-e, via ficha técnica) quando vendido à la
-- carte no departamento "Restaurante", e como SERVIÇO (NFS-e) quando lançado
-- num departamento de plano de refeição (MAP/FAP), sem precisar de
-- reclassificação manual a cada emissão.
--
-- IMPORTANTE: a baixa de estoque continua SEMPRE via a linha "default"
-- (erbon_department_id = 0) — as linhas de override (erbon_department_id > 0)
-- só podem apontar service_id, nunca product_id/dish_id. Ver
-- src/lib/erbonStockDeductionService.ts (fetch filtrado por dept=0) e
-- src/lib/nfService.ts (findMapping/resolveEntryFiscalData/resolveServiceFiscalData).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colunas novas. Sentinel 0 = "genérico/sem departamento específico"
--    (mesma convenção já usada em erbonService.ts / NFInvoiceModal.tsx /
--    EmissaoNFPage.tsx / BookingNFSection.tsx para idDepartment).
--    NOT NULL DEFAULT 0 (em vez de NULL) é proposital: permite usar uma
--    UNIQUE constraint normal (não parcial), que o supabase-js .upsert()
--    com onConflict consegue mirar diretamente.
ALTER TABLE erbon_product_mappings
  ADD COLUMN IF NOT EXISTS erbon_department_id INT NOT NULL DEFAULT 0;
ALTER TABLE erbon_product_mappings
  ADD COLUMN IF NOT EXISTS erbon_department TEXT;

-- 2. Substituir a unique constraint (hotel_id, erbon_service_id) por
--    (hotel_id, erbon_service_id, erbon_department_id) — permite N linhas
--    por produto Erbon (uma "default" com dept=0 + overrides por depto).
ALTER TABLE erbon_product_mappings
  DROP CONSTRAINT IF EXISTS erbon_product_mappings_hotel_id_erbon_service_id_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erbon_product_mappings_hotel_service_dept_key'
  ) THEN
    ALTER TABLE erbon_product_mappings
      ADD CONSTRAINT erbon_product_mappings_hotel_service_dept_key
      UNIQUE (hotel_id, erbon_service_id, erbon_department_id);
  END IF;
END $$;

-- 3. Nota: erbon_product_mappings_hotel_id_product_id_key UNIQUE(hotel_id,
--    product_id) permanece intacta e sem mudanças — como overrides nunca
--    setam product_id (ver CHECK abaixo), múltiplas linhas com
--    product_id NULL continuam permitidas (NULL <> NULL em UNIQUE do Postgres).

-- 4. Reforço de invariante: linha de override (dept != 0) não pode carregar
--    product_id/dish_id — a baixa de estoque é sempre feita pela ficha
--    técnica/produto da linha default (dept = 0).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_department_override_service_only'
  ) THEN
    ALTER TABLE erbon_product_mappings
      ADD CONSTRAINT chk_department_override_service_only
      CHECK (erbon_department_id = 0 OR (product_id IS NULL AND dish_id IS NULL));
  END IF;
END $$;

-- 5. Índice de apoio para consultas administrativas/relatórios por departamento.
CREATE INDEX IF NOT EXISTS idx_erbon_product_mappings_dept
  ON erbon_product_mappings (hotel_id, erbon_department_id);
