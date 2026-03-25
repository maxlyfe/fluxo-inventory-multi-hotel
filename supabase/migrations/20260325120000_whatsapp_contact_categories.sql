-- ============================================================================
-- WhatsApp Integration — Fix: contact_categories + supplier_contacts columns
-- ============================================================================

-- 1. Tabela contact_categories (referenciada no código mas ausente)
CREATE TABLE IF NOT EXISTS contact_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6B7280',
  icon text NOT NULL DEFAULT 'Tag',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contact_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage contact_categories"
  ON contact_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Colunas faltantes em supplier_contacts
ALTER TABLE supplier_contacts
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES contact_categories(id),
  ADD COLUMN IF NOT EXISTS employee_id uuid;

-- 3. Tornar hotel_id nullable (agenda compartilhada entre hotéis)
ALTER TABLE supplier_contacts ALTER COLUMN hotel_id DROP NOT NULL;

-- 4. Recriar unique index para funcionar com hotel_id NULL
DROP INDEX IF EXISTS supplier_contacts_hotel_id_whatsapp_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_unique_number
  ON supplier_contacts (COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'), whatsapp_number);

-- 5. Seed categorias padrão
INSERT INTO contact_categories (name, color, icon) VALUES
  ('Fornecedor', '#16A34A', 'ShoppingCart'),
  ('Prestador de Serviço', '#3B82F6', 'Wrench'),
  ('Colaborador', '#8B5CF6', 'User')
ON CONFLICT DO NOTHING;
