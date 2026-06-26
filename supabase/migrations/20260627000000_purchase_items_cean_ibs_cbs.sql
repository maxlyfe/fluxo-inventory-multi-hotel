-- Adiciona cEAN, IBS e CBS por item de compra
-- e NCM no cadastro de produtos (para atualização automática via XML)

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS cean TEXT,
  ADD COLUMN IF NOT EXISTS ibs  NUMERIC(15,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cbs  NUMERIC(15,4) DEFAULT 0;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ncm TEXT;

COMMENT ON COLUMN purchase_items.cean IS 'Código EAN/barcode do produto na NF-e';
COMMENT ON COLUMN purchase_items.ibs  IS 'Valor de crédito IBS gerado por este item';
COMMENT ON COLUMN purchase_items.cbs  IS 'Valor de crédito CBS gerado por este item';
COMMENT ON COLUMN products.ncm        IS 'Código NCM (Nomenclatura Comum do Mercosul) — preenchido automaticamente via XML NF-e';
