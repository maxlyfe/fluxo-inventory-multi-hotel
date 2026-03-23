-- ============================================================================
-- WhatsApp Business API Integration — Schema
-- ============================================================================

-- 1. Contatos de fornecedores (por hotel)
CREATE TABLE IF NOT EXISTS supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_name text,
  whatsapp_number text NOT NULL,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, whatsapp_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_hotel ON supplier_contacts(hotel_id);

-- 2. Vínculo N:N produto ↔ contato
CREATE TABLE IF NOT EXISTS product_supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES supplier_contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_psc_product ON product_supplier_contacts(product_id);
CREATE INDEX IF NOT EXISTS idx_psc_contact ON product_supplier_contacts(contact_id);

-- 3. Configuração WhatsApp (por hotel ou global quando hotel_id IS NULL)
CREATE TABLE IF NOT EXISTS whatsapp_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  waba_id text NOT NULL,
  access_token text NOT NULL,
  display_phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique: apenas 1 config por hotel (ou 1 global com hotel_id=NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_config_hotel
  ON whatsapp_configs (COALESCE(hotel_id, '00000000-0000-0000-0000-000000000000'));

-- 4. Templates de mensagem WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  template_name text NOT NULL,
  description text,
  language_code text NOT NULL DEFAULT 'pt_BR',
  parameter_mappings jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed templates padrão
INSERT INTO whatsapp_message_templates (template_key, template_name, description, parameter_mappings) VALUES
  ('budget_link_single', 'fluxo_cotacao_individual', 'Envio de link de cotação — hotel individual',
   '{"1": "greeting", "2": "hotel_name", "3": "budget_link"}'::jsonb),
  ('budget_link_group', 'fluxo_cotacao_grupo', 'Envio de link de cotação — grupo de hotéis',
   '{"1": "greeting", "2": "group_name", "3": "budget_link"}'::jsonb),
  ('purchase_approved', 'fluxo_compra_aprovada', 'Notificação de compra aprovada com imagem',
   '{"1": "hotel_name", "2": "supplier_name"}'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

-- 5. Log de mensagens enviadas (auditoria)
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id),
  contact_id uuid REFERENCES supplier_contacts(id),
  template_key text NOT NULL,
  whatsapp_message_id text,
  status text NOT NULL DEFAULT 'sent',
  metadata jsonb,
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid
);

CREATE INDEX IF NOT EXISTS idx_wa_log_hotel ON whatsapp_message_log(hotel_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_contact ON whatsapp_message_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_sent_at ON whatsapp_message_log(sent_at DESC);

-- RLS
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_log ENABLE ROW LEVEL SECURITY;

-- Policies permissivas (autenticados)
CREATE POLICY "Authenticated users manage supplier_contacts"
  ON supplier_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage product_supplier_contacts"
  ON product_supplier_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage whatsapp_configs"
  ON whatsapp_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users read whatsapp_message_templates"
  ON whatsapp_message_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage whatsapp_message_log"
  ON whatsapp_message_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
