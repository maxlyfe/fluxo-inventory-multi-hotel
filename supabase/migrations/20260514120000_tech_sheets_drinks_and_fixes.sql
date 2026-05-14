-- ============================================================================
-- ADICIONANDO TIPO EM FICHAS TÉCNICAS E AJUSTES DE ESTOQUE ATÔMICO
-- Data: 14/05/2026
-- ============================================================================

-- 1. Adicionar tipo em dishes (prato ou bebida)
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'dish' CHECK (type IN ('dish', 'drink'));
CREATE INDEX IF NOT EXISTS idx_dishes_type ON dishes(type);

-- 2. Adicionar tipo em erbon_sales_processed para facilitar relatórios
ALTER TABLE erbon_sales_processed ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'dish' CHECK (item_type IN ('dish', 'drink'));

-- 3. Melhorar a função de baixa de estoque para ser mais resiliente
-- (Já existe decrement_sector_stock, vamos garantir que ela seja usada no serviço)

-- 4. Garantir que erbon_product_mappings tenha índices para performance
CREATE INDEX IF NOT EXISTS idx_erbon_product_mappings_dish ON erbon_product_mappings(dish_id);
CREATE INDEX IF NOT EXISTS idx_erbon_product_mappings_service ON erbon_product_mappings(erbon_service_id);
