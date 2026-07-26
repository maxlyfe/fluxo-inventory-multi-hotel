-- Campos fiscais na ficha técnica (dishes) para uso como PRODUTO na NFC-e.
-- Quando a ficha tem NCM próprio, a emissão usa esses dados diretamente
-- (linha única do prato) em vez de decompor a ficha nos ingredientes.
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS nfce_ncm            TEXT,
  ADD COLUMN IF NOT EXISTS nfce_cest           TEXT,
  ADD COLUMN IF NOT EXISTS nfce_cfop           TEXT DEFAULT '5102',
  ADD COLUMN IF NOT EXISTS nfce_origem         TEXT DEFAULT '0',
  ADD COLUMN IF NOT EXISTS nfce_csosn          TEXT,
  ADD COLUMN IF NOT EXISTS nfce_cst            TEXT,
  ADD COLUMN IF NOT EXISTS nfce_icms_aliquota  NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nfce_unidade        TEXT DEFAULT 'UN',
  ADD COLUMN IF NOT EXISTS nfce_codigo         TEXT;

COMMENT ON COLUMN dishes.nfce_ncm IS 'NCM do produto (8 dígitos). Preenchido = ficha vira produto fiscal próprio na NFC-e.';
COMMENT ON COLUMN dishes.nfce_origem IS 'Origem da mercadoria (0=Nacional ... 8). Default 0.';
COMMENT ON COLUMN dishes.nfce_csosn IS 'CSOSN (Simples Nacional). Ex.: 102.';
COMMENT ON COLUMN dishes.nfce_cst IS 'CST ICMS (regime normal). Ex.: 00.';
