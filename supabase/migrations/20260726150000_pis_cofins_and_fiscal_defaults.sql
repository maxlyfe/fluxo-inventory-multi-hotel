-- PIS/COFINS por produto (ficha técnica) + padrões fiscais por hotel.
-- O default do hotel pré-preenche cada NOVA ficha; cada ficha guarda o próprio
-- valor (editável). Na emissão da NFC-e, o item usa o valor da ficha e, na
-- falta dele, cai no padrão do hotel.

-- 1. Campos PIS/COFINS na ficha técnica
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS nfce_pis_cst          TEXT,
  ADD COLUMN IF NOT EXISTS nfce_pis_aliquota     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS nfce_cofins_cst       TEXT,
  ADD COLUMN IF NOT EXISTS nfce_cofins_aliquota  NUMERIC(6,2);

-- 2. Padrões fiscais de produto por hotel (pré-preenchem novas fichas)
ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS prod_icms_aliquota    NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prod_pis_cst          TEXT DEFAULT '01',
  ADD COLUMN IF NOT EXISTS prod_pis_aliquota     NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prod_cofins_cst       TEXT DEFAULT '01',
  ADD COLUMN IF NOT EXISTS prod_cofins_aliquota  NUMERIC(6,2) DEFAULT 0;

-- 3. PIS/COFINS resolvidos no item da nota (para a emissão)
ALTER TABLE nf_invoice_items
  ADD COLUMN IF NOT EXISTS pis_cst          TEXT,
  ADD COLUMN IF NOT EXISTS pis_aliquota     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS cofins_cst       TEXT,
  ADD COLUMN IF NOT EXISTS cofins_aliquota  NUMERIC(6,2);

COMMENT ON COLUMN dishes.nfce_pis_cst IS 'CST PIS (ex.: 01 tributável). Vazio = usa padrão do hotel na emissão.';
COMMENT ON COLUMN nf_hotel_config.prod_pis_aliquota IS 'Alíquota PIS padrão dos produtos (ex.: 1.65).';
COMMENT ON COLUMN nf_hotel_config.prod_cofins_aliquota IS 'Alíquota COFINS padrão dos produtos (ex.: 7.60).';
