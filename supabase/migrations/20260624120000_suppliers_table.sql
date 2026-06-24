-- Tabela de Fornecedores (Pessoa Física e Pessoa Jurídica)
CREATE TABLE IF NOT EXISTS suppliers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            UUID REFERENCES hotels(id) ON DELETE CASCADE,

  -- Tipo: 'fisica' | 'juridica'
  type                TEXT NOT NULL CHECK (type IN ('fisica', 'juridica')),
  status              TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),

  -- Pessoa Física
  employee_id         UUID REFERENCES employees(id) ON DELETE SET NULL,
  nome                TEXT,
  cpf                 TEXT,
  rg                  TEXT,
  birth_date          DATE,

  -- Pessoa Jurídica
  cnpj                TEXT,
  razao_social        TEXT,
  nome_fantasia       TEXT,
  situacao            TEXT,
  situacao_cadastral  TEXT,
  tipo_empresa        TEXT,
  data_abertura       DATE,
  porte               TEXT,
  capital_social      NUMERIC(15,2),
  natureza_juridica   TEXT,
  cnae_principal_id   TEXT,
  cnae_principal_desc TEXT,
  atividade_economica JSONB,
  simples_nacional    BOOLEAN,
  mei                 BOOLEAN,
  ibs                 TEXT,
  cbs                 TEXT,
  lista_exclusao      JSONB,

  -- Contato (compartilhado PF/PJ)
  email               TEXT,
  telefone            TEXT,

  -- Endereço (compartilhado PF/PJ)
  endereco_cep        TEXT,
  endereco_logradouro TEXT,
  endereco_numero     TEXT,
  endereco_complemento TEXT,
  endereco_bairro     TEXT,
  endereco_municipio  TEXT,
  endereco_uf         TEXT,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select" ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_suppliers_hotel_id ON suppliers(hotel_id);
CREATE INDEX idx_suppliers_type     ON suppliers(type);
CREATE INDEX idx_suppliers_cnpj     ON suppliers(cnpj);
CREATE INDEX idx_suppliers_cpf      ON suppliers(cpf);
