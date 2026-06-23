-- Purchase Extended Fields Migration
-- Adds: document_type, emission_date, due_date, chart_account_sub_id to purchases
-- Creates: chart_of_accounts, chart_of_accounts_sub, purchase_document_types tables
-- Seeds: full chart of accounts from the company's official plan

-- 1. Extend purchases table
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS emission_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS chart_account_sub_id uuid;

-- 2. Chart of accounts - main categories
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 3. Chart of accounts - subcategories
CREATE TABLE IF NOT EXISTS chart_of_accounts_sub (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 4. Custom document types per hotel
CREATE TABLE IF NOT EXISTS purchase_document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 5. FK from purchases to chart_of_accounts_sub
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_purchases_chart_account_sub'
      AND table_name = 'purchases'
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT fk_purchases_chart_account_sub
      FOREIGN KEY (chart_account_sub_id)
      REFERENCES chart_of_accounts_sub(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_chart_accounts_hotel ON chart_of_accounts(hotel_id);
CREATE INDEX IF NOT EXISTS idx_chart_accounts_sub_account ON chart_of_accounts_sub(account_id);
CREATE INDEX IF NOT EXISTS idx_chart_accounts_sub_hotel ON chart_of_accounts_sub(hotel_id);
CREATE INDEX IF NOT EXISTS idx_purchase_doc_types_hotel ON purchase_document_types(hotel_id);
CREATE INDEX IF NOT EXISTS idx_purchases_chart_sub ON purchases(chart_account_sub_id);

-- 7. RLS
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts_sub ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chart_accounts_all_authenticated" ON chart_of_accounts;
CREATE POLICY "chart_accounts_all_authenticated"
  ON chart_of_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "chart_accounts_sub_all_authenticated" ON chart_of_accounts_sub;
CREATE POLICY "chart_accounts_sub_all_authenticated"
  ON chart_of_accounts_sub FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "purchase_doc_types_all_authenticated" ON purchase_document_types;
CREATE POLICY "purchase_doc_types_all_authenticated"
  ON purchase_document_types FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Seed global main accounts (only if not already seeded)
INSERT INTO chart_of_accounts (name, sort_order, hotel_id)
SELECT name, sort_order, NULL
FROM (VALUES
  ('Administrativo', 1),
  ('AI Telefonia/Internet/TV e Vídeo', 2),
  ('Alfredo', 3),
  ('Bancos/Transferências', 4),
  ('Comissão de Vendas', 5),
  ('Cozinha - A&B', 6),
  ('Escritório', 7),
  ('Financeiro', 8),
  ('Fiscais + Impostos', 9),
  ('Governança', 10),
  ('Investimento Finan/Aplic', 11),
  ('Investimentos', 12),
  ('Manutenção', 13),
  ('Marketing', 14),
  ('Recursos Humanos', 15),
  ('Transfer e Passeios', 16)
) AS t(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE hotel_id IS NULL AND chart_of_accounts.name = t.name
);

-- 9. Seed global subaccounts
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- 1. Administrativo
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Administrativo' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Aluguel Pousada', 1),
      (v_id, 'Depósitos Judiciais/Custos de Processos', 2),
      (v_id, 'Honorários Advocatícios', 3),
      (v_id, 'Honorários Consultorias', 4),
      (v_id, 'Honorários Contábeis', 5),
      (v_id, 'Prestação de Serviços/Terceirizados', 6),
      (v_id, 'Seguros Predial e Automóveis', 7),
      (v_id, 'Serviços Operacionais/Energia/Água/Gás', 8),
      (v_id, 'Sistemas de Gestão/Sistemas em Geral', 9);
  END IF;

  -- 2. AI Telefonia/Internet/TV e Vídeo
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'AI Telefonia/Internet/TV e Vídeo' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Equipamentos de Informática', 1),
      (v_id, 'Equipamentos de Telefonia', 2),
      (v_id, 'Equipamentos de TV e Vídeo', 3),
      (v_id, 'Planos de Internet', 4),
      (v_id, 'Planos de Telefonia', 5),
      (v_id, 'Planos de TV por Assinatura', 6);
  END IF;

  -- 3. Alfredo
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Alfredo' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Alfredo Salários e Pró-labore', 1),
      (v_id, 'Aportes Alfredo', 2),
      (v_id, 'Costa do Sol', 3),
      (v_id, 'Despesas Pessoais Alfredo', 4),
      (v_id, 'Pagamento Empréstimos Alfredo e Terceiros', 5),
      (v_id, 'Retirada Alfredo', 6),
      (v_id, 'Valentina', 7);
  END IF;

  -- 4. Bancos/Transferências
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Bancos/Transferências' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Empréstimo entre MM e CS', 1),
      (v_id, 'Empréstimo entre Pousadas', 2),
      (v_id, 'Empréstimo entre VP e CS', 3),
      (v_id, 'Transferências entre Bancos', 4),
      (v_id, 'Transferências entre o Caixa/Bancos', 5);
  END IF;

  -- 5. Comissão de Vendas
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Comissão de Vendas' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Comissões Gerais', 1),
      (v_id, 'Comissões OTAS e Agências', 2);
  END IF;

  -- 6. Cozinha - A&B
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Cozinha - A&B' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Carnes e Frios', 1),
      (v_id, 'Descartáveis e Plásticos em Geral', 2),
      (v_id, 'Fornecedores de Alimentos', 3),
      (v_id, 'Fornecedores de Bebidas', 4),
      (v_id, 'Hort Fruti', 5),
      (v_id, 'Mercado', 6),
      (v_id, 'Padaria', 7),
      (v_id, 'Peixaria', 8),
      (v_id, 'Utensílios e Equipamentos', 9);
  END IF;

  -- 7. Escritório
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Escritório' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Cartório - Correios', 1),
      (v_id, 'Impressora - Cartuchos e Recargas', 2),
      (v_id, 'Materiais Gráficos', 3),
      (v_id, 'Material de Escritório/Papelaria', 4);
  END IF;

  -- 8. Financeiro
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Financeiro' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Contestações e Chargeback - Cartões', 1),
      (v_id, 'Devoluções e Cancelamentos', 2),
      (v_id, 'Empréstimos Bancos', 3),
      (v_id, 'Financiamentos Veículos/Imóveis', 4),
      (v_id, 'Taxa Juros Antecipação Cartão', 5),
      (v_id, 'Taxas e Juros - Banco', 6);
  END IF;

  -- 9. Fiscais + Impostos
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Fiscais + Impostos' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Simples Nacional - DAS/ISS', 1),
      (v_id, 'Taxas - Dívidas - Acordos Prefeitura', 2),
      (v_id, 'Taxas Anuais - Prefeitura/Governo', 3);
  END IF;

  -- 10. Governança
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Governança' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Amenities - Gerais', 1),
      (v_id, 'Compras - Cama/Mesa/Banho', 2),
      (v_id, 'Compras - Equipamentos/Decoração', 3),
      (v_id, 'Lavanderia', 4),
      (v_id, 'Materiais de Limpeza', 5);
  END IF;

  -- 11. Investimento Finan/Aplic
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Investimento Finan/Aplic' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Consórcios Imóveis/Carros', 1),
      (v_id, 'Invest. Poupança ou Aplicação', 2),
      (v_id, 'Títulos de Capitalização', 3);
  END IF;

  -- 12. Investimentos
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Investimentos' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Invest. - Compras e Equipamentos', 1),
      (v_id, 'Mão de Obra - Investimento', 2),
      (v_id, 'Mat. de Construção - Investimento', 3),
      (v_id, 'Materiais em Geral Investimento', 4);
  END IF;

  -- 13. Manutenção
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Manutenção' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Abastecimento de Combustível', 1),
      (v_id, 'Bazar em Geral', 2),
      (v_id, 'Compra de Equipamentos em Geral', 3),
      (v_id, 'Frete e Transportadora', 4),
      (v_id, 'Gerador - Manutenção e Peças', 5),
      (v_id, 'Locação de Equipamentos', 6),
      (v_id, 'Madereira/Telhados em Geral', 7),
      (v_id, 'Manutenção Carros e Carro Golfe', 8),
      (v_id, 'Mão de Obra e Serviços em Geral', 9),
      (v_id, 'Marmoraria - Serviços em Geral', 10),
      (v_id, 'Mat. de Jardim/Dedetização/Piscina', 11),
      (v_id, 'Materiais de Construção e Diversos', 12),
      (v_id, 'Materiais de Elétrica/Hidráulica/Refrig.', 13),
      (v_id, 'Materiais de Pintura/Impermeabilização', 14),
      (v_id, 'Serviços de Conserto em Geral', 15),
      (v_id, 'Vidraçaria e Serralheria em Geral', 16);
  END IF;

  -- 14. Marketing
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Marketing' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Feiras e Eventos Externos - Viagens e Patrocínios', 1),
      (v_id, 'Reveillon e Eventos Internos', 2),
      (v_id, 'Serviços de Assessoria em MKT', 3),
      (v_id, 'Serviços de Divulgação/Publicidade', 4);
  END IF;

  -- 15. Recursos Humanos
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Recursos Humanos' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Adiantamentos e Vales', 1),
      (v_id, 'Benefícios/Bônus em Geral', 2),
      (v_id, 'Cursos e Treinamentos', 3),
      (v_id, 'Férias e 13° Salário', 4),
      (v_id, 'Horas Extras/Dobras/Diárias', 5),
      (v_id, 'Impostos de RH em Geral', 6),
      (v_id, 'Passagens e Transporte', 7),
      (v_id, 'Primeiros Socorros/Farmácia', 8),
      (v_id, 'Rescisões e Contratações', 9),
      (v_id, 'Salários', 10),
      (v_id, 'Sindicatos e Assessorias em Geral', 11),
      (v_id, 'Uniformes e Equipamentos em Geral', 12);
  END IF;

  -- 16. Transfer e Passeios
  SELECT id INTO v_id FROM chart_of_accounts WHERE name = 'Transfer e Passeios' AND hotel_id IS NULL LIMIT 1;
  IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts_sub WHERE account_id = v_id AND hotel_id IS NULL LIMIT 1) THEN
    INSERT INTO chart_of_accounts_sub (account_id, name, sort_order) VALUES
      (v_id, 'Pedágios/Estacionamento/Outros', 1),
      (v_id, 'Serviços de Transfer Parceiros/Terceiros', 2);
  END IF;
END $$;
