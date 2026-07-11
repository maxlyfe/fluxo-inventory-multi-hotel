-- Manifestação do Destinatário: rastreamento dos eventos enviados à SEFAZ
ALTER TABLE nf_received
  ADD COLUMN IF NOT EXISTS manifestacao TEXT
    CHECK (manifestacao IS NULL OR manifestacao IN ('210210', '210200', '210220', '210240')),
  ADD COLUMN IF NOT EXISTS manifestacao_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manifestacao_protocolo TEXT;
