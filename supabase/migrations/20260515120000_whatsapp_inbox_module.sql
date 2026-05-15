-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp Inbox Module
-- Tabelas: whatsapp_conversations, whatsapp_messages, whatsapp_labels,
--          whatsapp_conversation_labels, whatsapp_auto_responses,
--          whatsapp_broadcasts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── whatsapp_labels ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_labels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID REFERENCES hotels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6b7280',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_labels_hotel ON whatsapp_labels(hotel_id);
ALTER TABLE whatsapp_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_whatsapp_labels" ON whatsapp_labels FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── whatsapp_conversations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 UUID REFERENCES hotels(id) ON DELETE CASCADE,
  contact_phone            TEXT NOT NULL,
  contact_name             TEXT,
  contact_id               UUID,                              -- ref supplier_contacts if linked
  status                   TEXT NOT NULL DEFAULT 'open',      -- open | closed | bot
  assigned_to              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_message_at          TIMESTAMPTZ,
  last_message_preview     TEXT,
  unread_count             INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_convs_hotel_status ON whatsapp_conversations(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_convs_last_msg    ON whatsapp_conversations(hotel_id, last_message_at DESC);
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_wa_conversations" ON whatsapp_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_conversations;

-- ── whatsapp_messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  hotel_id             UUID REFERENCES hotels(id) ON DELETE SET NULL,
  whatsapp_message_id  TEXT,                                  -- wamid from Meta
  direction            TEXT NOT NULL,                        -- inbound | outbound
  type                 TEXT NOT NULL DEFAULT 'text',
  content              JSONB NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'pending',       -- pending | sent | delivered | read | failed
  sent_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_msgs_conv_time ON whatsapp_messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msgs_wamid     ON whatsapp_messages(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_wa_messages" ON whatsapp_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;

-- ── whatsapp_conversation_labels ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversation_labels (
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  label_id        UUID NOT NULL REFERENCES whatsapp_labels(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, label_id)
);
ALTER TABLE whatsapp_conversation_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_wa_conv_labels" ON whatsapp_conversation_labels FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── whatsapp_auto_responses ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_auto_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID REFERENCES hotels(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  trigger_type     TEXT NOT NULL DEFAULT 'first_message',     -- first_message | keyword | out_of_hours | always
  trigger_keywords TEXT[],
  response_text    TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  priority         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_auto_hotel ON whatsapp_auto_responses(hotel_id, is_active);
ALTER TABLE whatsapp_auto_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_wa_auto" ON whatsapp_auto_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── whatsapp_broadcasts ───────────────────────────────────────────────────────
-- Histórico de disparos em massa
CREATE TABLE IF NOT EXISTS whatsapp_broadcasts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID REFERENCES hotels(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  sent          INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  params        JSONB,                                        -- [{key, value}]
  targets       JSONB,                                        -- [{phone, name, status, error?}]
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_hotel ON whatsapp_broadcasts(hotel_id, created_at DESC);
ALTER TABLE whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rls_wa_broadcasts" ON whatsapp_broadcasts FOR ALL TO authenticated USING (true) WITH CHECK (true);
