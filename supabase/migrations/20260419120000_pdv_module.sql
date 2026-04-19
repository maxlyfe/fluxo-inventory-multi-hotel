-- ─────────────────────────────────────────────────────────────────────────────
-- PDV Module Migration
-- Adiciona: pdv_prices, pdv_sales, pdv_sale_items
--           + coluna erbon_department_id em erbon_sector_mappings
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Adicionar ID numérico ao mapeamento de setores Erbon
--    O campo erbon_department é TEXT (ex: "Restaurante"), mas o endpoint
--    POST /currentaccount do Erbon exige idDepartment: number.
--    Este campo permite armazenar o ID numérico correspondente.
ALTER TABLE erbon_sector_mappings
  ADD COLUMN IF NOT EXISTS erbon_department_id INT;

-- 2. Preços de venda por produto por hotel
--    Separado da tabela products para não misturar custo (average_price) com preço de venda.
--    sector_id = NULL → preço padrão do hotel
--    sector_id preenchido → override por setor (happy hour, etc.)
CREATE TABLE IF NOT EXISTS pdv_prices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sector_id   UUID REFERENCES sectors(id) ON DELETE CASCADE,
  sale_price  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pdv_prices UNIQUE (hotel_id, product_id, sector_id)
);

CREATE INDEX IF NOT EXISTS idx_pdv_prices_lookup ON pdv_prices (hotel_id, product_id);

-- 3. Cabeçalho da venda PDV
--    Registra a venda completa para auditoria e histórico local,
--    independente de o Erbon ter sido contactado com sucesso.
CREATE TABLE IF NOT EXISTS pdv_sales (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  sector_id            UUID NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
  booking_internal_id  INT NOT NULL,
  booking_number       TEXT NOT NULL,
  room_description     TEXT NOT NULL,
  guest_name           TEXT NOT NULL,
  operator_name        TEXT,
  total_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'completed'
                         CHECK (status IN ('completed', 'cancelled', 'partial')),
  erbon_posted         BOOLEAN NOT NULL DEFAULT false,
  erbon_post_error     TEXT,
  notes                TEXT,
  sale_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_sales_hotel_date ON pdv_sales (hotel_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_sales_booking    ON pdv_sales (hotel_id, booking_internal_id);
CREATE INDEX IF NOT EXISTS idx_pdv_sales_sector     ON pdv_sales (hotel_id, sector_id);

-- 4. Itens da venda PDV (linhas do pedido)
--    Cada item tem seu próprio status de lançamento no Erbon,
--    permitindo retry granular por item sem reprocessar a venda toda.
CREATE TABLE IF NOT EXISTS pdv_sale_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          UUID NOT NULL REFERENCES pdv_sales(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name     TEXT NOT NULL,
  quantity         NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit_price       NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_price      NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  erbon_service_id INT,
  erbon_department TEXT,
  erbon_posted     BOOLEAN NOT NULL DEFAULT false,
  erbon_post_error TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_sale_items_sale    ON pdv_sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_pdv_sale_items_product ON pdv_sale_items (product_id);

-- 5. RLS — acesso total a usuários autenticados
--    (permissões granulares são controladas pela camada de aplicação via módulo 'pdv')
ALTER TABLE pdv_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdv_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdv_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdv_prices: auth full access"
  ON pdv_prices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "pdv_sales: auth full access"
  ON pdv_sales FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "pdv_sale_items: auth full access"
  ON pdv_sale_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
