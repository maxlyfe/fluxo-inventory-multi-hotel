-- Migration: reservas internas (hotéis SEM integração Erbon)
-- Permite criar/editar reservas direto no Planning: UH, datas, hóspede,
-- pagamentos, check-in/check-out. O código curto (code) é usado como
-- "número de reserva" no web-checkin manual.

CREATE TABLE IF NOT EXISTS internal_bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_id     uuid REFERENCES hotel_rooms(id) ON DELETE SET NULL,
  code        text NOT NULL DEFAULT upper(substr(md5(random()::text), 1, 6)),
  guest_name  text NOT NULL,
  guest_phone text,
  guest_email text,
  checkin     date NOT NULL,
  checkout    date NOT NULL,
  adults      integer NOT NULL DEFAULT 2,
  children    integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'confirmed',  -- confirmed | checkedin | checkedout | cancelled
  total_rate  numeric,
  notes       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_bookings_hotel_checkout
  ON internal_bookings(hotel_id, checkout);
CREATE INDEX IF NOT EXISTS idx_internal_bookings_hotel_room
  ON internal_bookings(hotel_id, room_id);

CREATE TABLE IF NOT EXISTS internal_booking_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES internal_bookings(id) ON DELETE CASCADE,
  hotel_id   uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  amount     numeric NOT NULL,
  method     text,                                 -- dinheiro | pix | cartao_credito | cartao_debito | transferencia | outro
  notes      text,
  paid_at    timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_internal_booking_payments_booking
  ON internal_booking_payments(booking_id);

-- ── RLS (padrão permissivo do projeto) ───────────────────────────────────────
ALTER TABLE internal_bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_booking_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal_bookings_select" ON internal_bookings FOR SELECT USING (true);
CREATE POLICY "internal_bookings_insert" ON internal_bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "internal_bookings_update" ON internal_bookings FOR UPDATE USING (true);
CREATE POLICY "internal_bookings_delete" ON internal_bookings FOR DELETE USING (true);

CREATE POLICY "internal_booking_payments_select" ON internal_booking_payments FOR SELECT USING (true);
CREATE POLICY "internal_booking_payments_insert" ON internal_booking_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "internal_booking_payments_update" ON internal_booking_payments FOR UPDATE USING (true);
CREATE POLICY "internal_booking_payments_delete" ON internal_booking_payments FOR DELETE USING (true);
