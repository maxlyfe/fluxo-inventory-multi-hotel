-- Migration: cache local do Planning (UHs, categorias e reservas da Erbon)
-- O mapa de hospedagem renderiza instantaneamente com os dados salvos e a
-- sincronização com a Erbon roda em segundo plano atualizando o cache.

-- ── UHs / categorias mapeadas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erbon_rooms_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  erbon_room_id integer NOT NULL,
  room_name     text NOT NULL,
  room_type     text,
  floor         integer,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, erbon_room_id)
);

CREATE INDEX IF NOT EXISTS idx_erbon_rooms_cache_hotel
  ON erbon_rooms_cache(hotel_id);

-- ── Reservas mapeadas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erbon_bookings_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_internal_id bigint NOT NULL,
  status              text,
  checkin             timestamptz,
  checkout            timestamptz,
  room_id             integer,
  payload             jsonb NOT NULL,   -- ErbonBooking completo (popover/render)
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, booking_internal_id)
);

CREATE INDEX IF NOT EXISTS idx_erbon_bookings_cache_hotel_checkout
  ON erbon_bookings_cache(hotel_id, checkout);
CREATE INDEX IF NOT EXISTS idx_erbon_bookings_cache_hotel_checkin
  ON erbon_bookings_cache(hotel_id, checkin);

-- ── RLS (mesmo padrão permissivo das demais tabelas Erbon) ───────────────────
ALTER TABLE erbon_rooms_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE erbon_bookings_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erbon_rooms_cache_select" ON erbon_rooms_cache FOR SELECT USING (true);
CREATE POLICY "erbon_rooms_cache_insert" ON erbon_rooms_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "erbon_rooms_cache_update" ON erbon_rooms_cache FOR UPDATE USING (true);
CREATE POLICY "erbon_rooms_cache_delete" ON erbon_rooms_cache FOR DELETE USING (true);

CREATE POLICY "erbon_bookings_cache_select" ON erbon_bookings_cache FOR SELECT USING (true);
CREATE POLICY "erbon_bookings_cache_insert" ON erbon_bookings_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "erbon_bookings_cache_update" ON erbon_bookings_cache FOR UPDATE USING (true);
CREATE POLICY "erbon_bookings_cache_delete" ON erbon_bookings_cache FOR DELETE USING (true);
