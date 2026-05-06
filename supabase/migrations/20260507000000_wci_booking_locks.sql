-- Migration: WCI Booking Locks
-- Permite que supervisores bloqueiem um nº de reserva, impedindo
-- que hóspedes façam (ou refaçam) web check-in nessa reserva.
-- Aplica-se apenas a hotéis sem integração Erbon (validação manual).

CREATE TABLE public.wci_booking_locks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_number text NOT NULL,
  locked_by      uuid REFERENCES profiles(id),
  locked_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, booking_number)
);

CREATE INDEX idx_wci_booking_locks_hotel ON public.wci_booking_locks (hotel_id);

ALTER TABLE public.wci_booking_locks ENABLE ROW LEVEL SECURITY;

-- Colaboradores autenticados podem gerir os bloqueios
CREATE POLICY "auth_manage_booking_locks"
  ON public.wci_booking_locks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anon pode LER (necessário para o web check-in validar o bloqueio)
CREATE POLICY "anon_read_booking_locks"
  ON public.wci_booking_locks FOR SELECT TO anon
  USING (true);
