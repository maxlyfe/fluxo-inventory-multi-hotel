-- =====================================================
-- NFC-e (Nota Fiscal do Consumidor Eletrônica) — Modelo 65
-- =====================================================

-- 1. Atualizar check constraint de tipo para incluir 'nfce'
ALTER TABLE nf_invoices DROP CONSTRAINT IF EXISTS nf_invoices_tipo_check;
ALTER TABLE nf_invoices ADD CONSTRAINT nf_invoices_tipo_check
  CHECK (tipo IN ('nfse','nfe','nfce'));

-- 2. Campos NFC-e na configuração do hotel
ALTER TABLE nf_hotel_config ADD COLUMN IF NOT EXISTS nfce_enabled BOOLEAN DEFAULT false;
ALTER TABLE nf_hotel_config ADD COLUMN IF NOT EXISTS serie_nfce TEXT DEFAULT '1';
ALTER TABLE nf_hotel_config ADD COLUMN IF NOT EXISTS proximo_numero_nfce INT DEFAULT 1;
ALTER TABLE nf_hotel_config ADD COLUMN IF NOT EXISTS nfce_csc_id TEXT;
ALTER TABLE nf_hotel_config ADD COLUMN IF NOT EXISTS nfce_csc_token TEXT;

-- 3. Campo QR code na invoice (NFC-e obrigatório)
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS qrcode_url TEXT;
ALTER TABLE nf_invoices ADD COLUMN IF NOT EXISTS url_consulta TEXT;
