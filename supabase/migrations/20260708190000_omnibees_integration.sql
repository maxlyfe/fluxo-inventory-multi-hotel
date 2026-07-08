-- Migration: integração Omnibees (PMS Pull WebService — OTA 2014B)
-- Credenciais por hotel + campos de origem nas reservas internas para que
-- reservas puxadas da Omnibees entrem no planning/rack como internal_bookings.

CREATE TABLE IF NOT EXISTS omnibees_hotel_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  hotel_code   text NOT NULL,                     -- HotelCode na Omnibees
  chain_code   text,                              -- obrigatório só quando configurado na Omnibees
  user_code    text NOT NULL,                     -- nome do PMS na Omnibees
  username     text NOT NULL,
  password     text NOT NULL,
  base_url     text NOT NULL DEFAULT 'https://pms.omnibees.com/OTA2014B/PullWebService.asmx',
  is_active    boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id)
);

-- Origem das reservas internas: internal (manual) | omnibees
ALTER TABLE internal_bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';
ALTER TABLE internal_bookings ADD COLUMN IF NOT EXISTS external_id text;   -- nº da reserva na Omnibees
ALTER TABLE internal_bookings ADD COLUMN IF NOT EXISTS channel text;       -- canal de venda (Booking, Expedia...)

CREATE UNIQUE INDEX IF NOT EXISTS uniq_internal_bookings_external
  ON internal_bookings(hotel_id, external_id) WHERE external_id IS NOT NULL;

-- ── RLS (padrão permissivo do projeto) ───────────────────────────────────────
ALTER TABLE omnibees_hotel_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "omnibees_hotel_config_select" ON omnibees_hotel_config FOR SELECT USING (true);
CREATE POLICY "omnibees_hotel_config_insert" ON omnibees_hotel_config FOR INSERT WITH CHECK (true);
CREATE POLICY "omnibees_hotel_config_update" ON omnibees_hotel_config FOR UPDATE USING (true);
CREATE POLICY "omnibees_hotel_config_delete" ON omnibees_hotel_config FOR DELETE USING (true);
