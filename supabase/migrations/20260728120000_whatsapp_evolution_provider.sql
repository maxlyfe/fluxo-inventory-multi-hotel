-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp: provider por hotel (meta | evolution)
--
-- Adiciona suporte ao Evolution API (Baileys, self-hosted) como alternativa
-- gratuita à Meta Cloud API. Cada hotel escolhe seu provider em whatsapp_configs.
--
-- Campos Meta      : phone_number_id, waba_id, access_token
-- Campos Evolution : base_url, api_key, instance_name
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Novas colunas em whatsapp_configs ─────────────────────────────────────

ALTER TABLE whatsapp_configs
  ADD COLUMN IF NOT EXISTS provider          text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS base_url          text,
  ADD COLUMN IF NOT EXISTS api_key           text,
  ADD COLUMN IF NOT EXISTS instance_name     text,
  ADD COLUMN IF NOT EXISTS connection_status text,
  ADD COLUMN IF NOT EXISTS connected_at      timestamptz;

-- Credenciais Meta passam a ser opcionais (não se aplicam ao Evolution)
ALTER TABLE whatsapp_configs ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_configs ALTER COLUMN waba_id         DROP NOT NULL;
ALTER TABLE whatsapp_configs ALTER COLUMN access_token    DROP NOT NULL;

-- ── 2. Constraints ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wa_provider') THEN
    ALTER TABLE whatsapp_configs
      ADD CONSTRAINT chk_wa_provider CHECK (provider IN ('meta', 'evolution'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wa_provider_fields') THEN
    ALTER TABLE whatsapp_configs
      ADD CONSTRAINT chk_wa_provider_fields CHECK (
        (provider = 'meta'
          AND phone_number_id IS NOT NULL
          AND access_token    IS NOT NULL)
        OR
        (provider = 'evolution'
          AND base_url      IS NOT NULL
          AND api_key       IS NOT NULL
          AND instance_name IS NOT NULL)
      );
  END IF;
END $$;

-- O webhook do Evolution identifica a origem pelo campo "instance" do payload,
-- então instance_name precisa ser globalmente único.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_config_instance
  ON whatsapp_configs (instance_name)
  WHERE instance_name IS NOT NULL;

-- Lookup do webhook por instance_name
CREATE INDEX IF NOT EXISTS idx_wa_config_provider
  ON whatsapp_configs (provider, is_active);

-- ── 3. Templates: corpo em texto puro para o Evolution ──────────────────────
-- O Evolution não tem templates aprovados pela Meta. O corpo da mensagem fica
-- armazenado aqui com placeholders {{1}}, {{2}}, ... e é interpolado no cliente
-- usando os mesmos bodyParams já enviados para a Meta.

ALTER TABLE whatsapp_message_templates
  ADD COLUMN IF NOT EXISTS body_text text;

UPDATE whatsapp_message_templates SET body_text =
  '{{1}}! Segue o link para preenchimento da cotação do {{2}}:' || E'\n\n' ||
  '{{3}}' || E'\n\n' ||
  'Qualquer dúvida estamos à disposição.'
WHERE template_key = 'budget_link_single' AND body_text IS NULL;

UPDATE whatsapp_message_templates SET body_text =
  '{{1}}! Segue o link para preenchimento da cotação do grupo {{2}}:' || E'\n\n' ||
  '{{3}}' || E'\n\n' ||
  'Qualquer dúvida estamos à disposição.'
WHERE template_key = 'budget_link_group' AND body_text IS NULL;

UPDATE whatsapp_message_templates SET body_text =
  'Compra aprovada para {{1}}.' || E'\n' ||
  'Fornecedor: {{2}}' || E'\n\n' ||
  'O comprovante segue em anexo.'
WHERE template_key = 'purchase_approved' AND body_text IS NULL;

-- ── 4. Broadcast: registrar qual provider foi usado no disparo ───────────────

ALTER TABLE whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS provider   text,
  ADD COLUMN IF NOT EXISTS body_text  text;

-- ── 5. Deduplicação de mensagens por id do WhatsApp ─────────────────────────
-- O Evolution reenvia messages.upsert quando a instância reconecta. Um índice
-- único em whatsapp_message_id permite usar upsert com onConflict no webhook.

-- Remove duplicatas pré-existentes (mantém a linha mais antiga de cada id)
DELETE FROM whatsapp_messages m
USING whatsapp_messages keep
WHERE m.whatsapp_message_id IS NOT NULL
  AND m.whatsapp_message_id = keep.whatsapp_message_id
  AND (m.created_at, m.id) > (keep.created_at, keep.id);

-- O índice precisa ser total (sem WHERE) para que ON CONFLICT o infira a partir
-- do supabase-js, que não expressa o predicado. NULLs continuam sendo tratados
-- como distintos pelo Postgres, então mensagens sem id do WhatsApp não colidem.
DROP INDEX IF EXISTS idx_wa_msgs_wamid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_msgs_wamid
  ON whatsapp_messages (whatsapp_message_id);
