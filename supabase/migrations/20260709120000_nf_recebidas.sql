-- =====================================================
-- NF Recebidas — Consulta de NF-e emitidas contra o CNPJ
-- (SEFAZ NFeDistribuicaoDFe) + rastreio de lançamento em compras
-- =====================================================

-- 1. Flags/estado na configuração fiscal do hotel
ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nf_recebidas_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dfe_ultimo_nsu       TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS dfe_ultima_consulta  TIMESTAMPTZ;

-- 2. Documentos recebidos via Distribuição DF-e
CREATE TABLE IF NOT EXISTS nf_received (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  nsu             TEXT,
  schema_doc      TEXT,                       -- procNFe / resNFe / resEvento...
  tipo            TEXT NOT NULL DEFAULT 'resumo'
                    CHECK (tipo IN ('resumo', 'completa')),

  chave_acesso    TEXT NOT NULL,
  numero_nf       TEXT,
  serie           TEXT,
  emitente_nome   TEXT,
  emitente_cnpj   TEXT,
  valor_total     NUMERIC(12,2),
  data_emissao    TIMESTAMPTZ,

  xml             TEXT,                       -- XML completo (procNFe) ou resumo

  situacao        TEXT NOT NULL DEFAULT 'nova'
                    CHECK (situacao IN ('nova', 'lancada', 'ignorada')),
  purchase_id     UUID REFERENCES purchases(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nf_received_chave UNIQUE (hotel_id, chave_acesso)
);

CREATE INDEX IF NOT EXISTS idx_nf_received_hotel    ON nf_received(hotel_id);
CREATE INDEX IF NOT EXISTS idx_nf_received_situacao ON nf_received(hotel_id, situacao);

ALTER TABLE nf_received ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nf_received: auth full access" ON nf_received;
CREATE POLICY "nf_received: auth full access"
  ON nf_received FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
