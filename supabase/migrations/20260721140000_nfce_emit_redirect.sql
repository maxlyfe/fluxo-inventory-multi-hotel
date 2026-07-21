-- Redirecionamento de emissão de NFC-e para outra unidade do mesmo grupo.
-- Caso de uso: unidade que vende mas não fatura (sem IE) emite o cupom com a
-- identidade fiscal da unidade responsável (certificado/IE/CSC/CNPJ/numeração).
ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfce_emit_redirect_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfce_emit_redirect_hotel_id uuid REFERENCES hotels(id);
