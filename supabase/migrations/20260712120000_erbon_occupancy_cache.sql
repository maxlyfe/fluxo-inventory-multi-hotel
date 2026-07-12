-- Migration: cache diário de ocupação da Erbon (erbon_occupancy_daily)
-- Alimentado pelo job pickup-daily-snapshot (8h BRT) e pelo refresh em tempo
-- real da tela Vendas & Ocupação. Uma linha por hotel por dia — o dashboard
-- anual lê daqui instantaneamente em vez de pedir 365 dias à Erbon numa
-- chamada só (que estourava o timeout do proxy → 502).

CREATE TABLE IF NOT EXISTS erbon_occupancy_daily (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date         date NOT NULL,
  occupancy    numeric NOT NULL DEFAULT 0,   -- % de ocupação do dia
  rooms_sold   integer NOT NULL DEFAULT 0,   -- roomSalledConfirmed
  room_revenue numeric NOT NULL DEFAULT 0,   -- totalDailyRate (receita de quartos)
  adr          numeric NOT NULL DEFAULT 0,
  payload      jsonb,                        -- resposta completa da Erbon
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, date)
);

CREATE INDEX IF NOT EXISTS idx_erbon_occupancy_hotel_date
  ON erbon_occupancy_daily(hotel_id, date);

ALTER TABLE erbon_occupancy_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "erbon_occupancy_daily_select" ON erbon_occupancy_daily FOR SELECT USING (true);
  CREATE POLICY "erbon_occupancy_daily_insert" ON erbon_occupancy_daily FOR INSERT WITH CHECK (true);
  CREATE POLICY "erbon_occupancy_daily_update" ON erbon_occupancy_daily FOR UPDATE USING (true);
  CREATE POLICY "erbon_occupancy_daily_delete" ON erbon_occupancy_daily FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
