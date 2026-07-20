-- =====================================================
-- Sistema NF-e / NFS-e — Configuração e Emissão
-- =====================================================

-- 1. Configuração fiscal por hotel
CREATE TABLE IF NOT EXISTS nf_hotel_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  ambiente                TEXT NOT NULL DEFAULT 'homologacao'
                            CHECK (ambiente IN ('homologacao', 'producao')),

  -- Dados da empresa (pode sobrescrever dados do hotel)
  razao_social            TEXT,
  nome_fantasia           TEXT,
  cnpj                    TEXT,
  endereco_logradouro     TEXT,
  endereco_numero         TEXT,
  endereco_complemento    TEXT,
  endereco_bairro         TEXT,
  endereco_cidade         TEXT,
  endereco_uf             TEXT DEFAULT 'RJ',
  endereco_cep            TEXT,
  endereco_codigo_municipio TEXT DEFAULT '3300233', -- Armação dos Búzios IBGE
  telefone                TEXT,
  email                   TEXT,

  -- NFS-e (Prefeitura de Armação dos Búzios — ABRASF)
  nfse_enabled            BOOLEAN NOT NULL DEFAULT false,
  inscricao_municipal     TEXT,
  regime_tributario_nfse  TEXT,
  codigo_servico          TEXT,
  aliquota_iss            NUMERIC(5,2) DEFAULT 5.00,
  serie_nfse              TEXT DEFAULT 'NFS',
  proximo_numero_nfse     INT DEFAULT 1,
  prefeitura_login        TEXT,
  prefeitura_senha        TEXT,

  -- NF-e (SEFAZ-RJ — Estado do Rio de Janeiro)
  nfe_enabled             BOOLEAN NOT NULL DEFAULT false,
  inscricao_estadual      TEXT,
  crt                     INT DEFAULT 1, -- 1=Simples, 2=Simples exc., 3=Normal
  serie_nfe               TEXT DEFAULT '1',
  proximo_numero_nfe      INT DEFAULT 1,
  csc_id                  TEXT,
  csc_token               TEXT,

  -- Certificado digital A1 (compartilhado NF-e e NFS-e)
  certificado_base64      TEXT,
  certificado_senha       TEXT,
  certificado_validade    TIMESTAMPTZ,

  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nf_hotel_config UNIQUE (hotel_id)
);

-- 2. Notas fiscais emitidas
CREATE TABLE IF NOT EXISTS nf_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('nfse', 'nfe')),

  -- Referência da reserva
  erbon_booking_id        INT,
  booking_number          TEXT,
  room_description        TEXT,

  -- Tomador (destinatário)
  tomador_nome            TEXT NOT NULL,
  tomador_cpf_cnpj        TEXT,
  tomador_email           TEXT,
  tomador_endereco        TEXT,

  -- Valores
  valor_total             NUMERIC(10,2) NOT NULL DEFAULT 0,
  valor_deducoes          NUMERIC(10,2) DEFAULT 0,
  valor_iss               NUMERIC(10,2) DEFAULT 0,
  base_calculo            NUMERIC(10,2) DEFAULT 0,
  aliquota                NUMERIC(5,2) DEFAULT 0,

  -- Status
  status                  TEXT NOT NULL DEFAULT 'rascunho'
                            CHECK (status IN ('rascunho','emitida','autorizada','rejeitada','cancelada')),

  -- Retorno fiscal
  numero_nf               TEXT,
  serie                   TEXT,
  chave_acesso            TEXT,
  numero_protocolo        TEXT,
  codigo_verificacao      TEXT,
  xml_envio               TEXT,
  xml_retorno             TEXT,
  pdf_url                 TEXT,

  -- Cancelamento
  cancelada_em            TIMESTAMPTZ,
  motivo_cancelamento     TEXT,
  xml_cancelamento        TEXT,

  -- Auditoria
  emitido_por             UUID REFERENCES profiles(id),
  cancelado_por           UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Itens de cada nota fiscal
CREATE TABLE IF NOT EXISTS nf_invoice_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              UUID NOT NULL REFERENCES nf_invoices(id) ON DELETE CASCADE,
  erbon_entry_id          INT,

  descricao               TEXT NOT NULL,
  quantidade              NUMERIC(10,3) NOT NULL DEFAULT 1,
  valor_unitario          NUMERIC(10,2) NOT NULL DEFAULT 0,
  valor_total             NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Campos NF-e (produtos)
  ncm                     TEXT,
  cfop                    TEXT,
  icms_aliquota           NUMERIC(5,2),
  icms_valor              NUMERIC(10,2),

  -- Campos NFS-e (serviços)
  codigo_servico          TEXT,
  iss_aliquota            NUMERIC(5,2),
  iss_valor               NUMERIC(10,2),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Rastreio de lançamentos Erbon já faturados
CREATE TABLE IF NOT EXISTS nf_emitted_entries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  erbon_entry_id          INT NOT NULL,
  invoice_id              UUID NOT NULL REFERENCES nf_invoices(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nf_emitted_entry UNIQUE (hotel_id, erbon_entry_id)
);

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nf_invoices_hotel     ON nf_invoices(hotel_id);
CREATE INDEX IF NOT EXISTS idx_nf_invoices_status    ON nf_invoices(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_nf_invoices_booking   ON nf_invoices(hotel_id, erbon_booking_id);
CREATE INDEX IF NOT EXISTS idx_nf_invoice_items_inv  ON nf_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_nf_emitted_hotel      ON nf_emitted_entries(hotel_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE nf_hotel_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nf_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nf_invoice_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nf_emitted_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nf_hotel_config: auth full access"
  ON nf_hotel_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "nf_invoices: auth full access"
  ON nf_invoices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "nf_invoice_items: auth full access"
  ON nf_invoice_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "nf_emitted_entries: auth full access"
  ON nf_emitted_entries FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
