-- ============================================================================
-- ERBON PMS INTEGRATION
-- Tabelas para configuração, mapeamentos de produtos/setores e cache de transações
-- ============================================================================

-- 1) Configuração Erbon por hotel
CREATE TABLE IF NOT EXISTS erbon_hotel_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  erbon_hotel_id text NOT NULL,
  erbon_username text NOT NULL,
  erbon_password text NOT NULL,
  erbon_base_url text NOT NULL DEFAULT 'https://api.erbonsoftware.com',
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id)
);

-- 2) Mapeamento de produtos: Fluxo ↔ Erbon (1:1)
CREATE TABLE IF NOT EXISTS erbon_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  erbon_service_id integer NOT NULL,
  erbon_service_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, product_id),
  UNIQUE(hotel_id, erbon_service_id)
);

-- 3) Mapeamento de setores: Fluxo ↔ Departamentos Erbon (1:N)
CREATE TABLE IF NOT EXISTS erbon_sector_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  erbon_department text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, sector_id, erbon_department)
);

-- 4) Cache de transações Erbon (evita re-fetch)
CREATE TABLE IF NOT EXISTS erbon_transaction_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  erbon_service_id integer NOT NULL,
  erbon_department text,
  id_source text,
  quantity numeric NOT NULL DEFAULT 0,
  value_total numeric NOT NULL DEFAULT 0,
  is_canceled boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para consultas rápidas no cache
CREATE INDEX IF NOT EXISTS idx_erbon_tx_cache_hotel_date
  ON erbon_transaction_cache(hotel_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_erbon_tx_cache_service
  ON erbon_transaction_cache(hotel_id, erbon_service_id);

-- 5) Coluna sales_source na tabela de itens de reconciliação
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reconciliation_report_items'
    AND column_name = 'sales_source'
  ) THEN
    ALTER TABLE reconciliation_report_items
      ADD COLUMN sales_source text DEFAULT 'manual';
  END IF;
END $$;

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================

ALTER TABLE erbon_hotel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE erbon_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erbon_sector_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erbon_transaction_cache ENABLE ROW LEVEL SECURITY;

-- Políticas para erbon_hotel_config (admin only - credenciais sensíveis)
CREATE POLICY "erbon_hotel_config_select" ON erbon_hotel_config
  FOR SELECT USING (true);

CREATE POLICY "erbon_hotel_config_insert" ON erbon_hotel_config
  FOR INSERT WITH CHECK (true);

CREATE POLICY "erbon_hotel_config_update" ON erbon_hotel_config
  FOR UPDATE USING (true);

CREATE POLICY "erbon_hotel_config_delete" ON erbon_hotel_config
  FOR DELETE USING (true);

-- Políticas para erbon_product_mappings
CREATE POLICY "erbon_product_mappings_select" ON erbon_product_mappings
  FOR SELECT USING (true);

CREATE POLICY "erbon_product_mappings_insert" ON erbon_product_mappings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "erbon_product_mappings_update" ON erbon_product_mappings
  FOR UPDATE USING (true);

CREATE POLICY "erbon_product_mappings_delete" ON erbon_product_mappings
  FOR DELETE USING (true);

-- Políticas para erbon_sector_mappings
CREATE POLICY "erbon_sector_mappings_select" ON erbon_sector_mappings
  FOR SELECT USING (true);

CREATE POLICY "erbon_sector_mappings_insert" ON erbon_sector_mappings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "erbon_sector_mappings_update" ON erbon_sector_mappings
  FOR UPDATE USING (true);

CREATE POLICY "erbon_sector_mappings_delete" ON erbon_sector_mappings
  FOR DELETE USING (true);

-- Políticas para erbon_transaction_cache
CREATE POLICY "erbon_transaction_cache_select" ON erbon_transaction_cache
  FOR SELECT USING (true);

CREATE POLICY "erbon_transaction_cache_insert" ON erbon_transaction_cache
  FOR INSERT WITH CHECK (true);

CREATE POLICY "erbon_transaction_cache_update" ON erbon_transaction_cache
  FOR UPDATE USING (true);

CREATE POLICY "erbon_transaction_cache_delete" ON erbon_transaction_cache
  FOR DELETE USING (true);
