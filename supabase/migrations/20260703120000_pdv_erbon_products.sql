-- ─────────────────────────────────────────────────────────────────────────────
-- PDV Erbon Products Cache
-- Cache local dos produtos Erbon para evitar chamadas à API a cada acesso.
-- Permite adicionar imagens personalizadas e desativar itens do PDV.
-- Sincronização manual + automática diária.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Permitir itens de venda sem produto local (produtos Erbon diretos)
ALTER TABLE pdv_sale_items ALTER COLUMN product_id DROP NOT NULL;

-- 2. Cache de produtos Erbon
CREATE TABLE IF NOT EXISTS erbon_cached_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  erbon_service_id INT NOT NULL,
  erbon_code       TEXT,
  description      TEXT NOT NULL,
  category         TEXT,
  family           TEXT,
  unit_measure     TEXT,
  sale_price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  image_url        TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_erbon_cached_product UNIQUE (hotel_id, erbon_service_id)
);

CREATE INDEX IF NOT EXISTS idx_erbon_cached_products_hotel
  ON erbon_cached_products (hotel_id, is_active);

-- 3. Metadata de sincronização por hotel
CREATE TABLE IF NOT EXISTS erbon_sync_metadata (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE UNIQUE,
  last_product_sync TIMESTAMPTZ,
  product_count    INT NOT NULL DEFAULT 0,
  sync_status      TEXT NOT NULL DEFAULT 'idle'
                     CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. RLS
ALTER TABLE erbon_cached_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE erbon_sync_metadata   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erbon_cached_products: auth full access"
  ON erbon_cached_products FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "erbon_sync_metadata: auth full access"
  ON erbon_sync_metadata FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
