-- Migration: colunas extraídas na erbon_hospedagem_daily + tabela erbon_segmentsview_daily
-- Contrato validado ao vivo contra a API Erbon (swagger /hotel/{id}/hospedagem e
-- /hotel/{id}/booking/segmentsview): uma linha por reserva por dia de estadia,
-- com valor real da diária inclusive para datas FUTURAS.

-- ── Colunas extraídas para consulta sem abrir o JSONB ────────────────────────
ALTER TABLE erbon_hospedagem_daily ADD COLUMN IF NOT EXISTS daily_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE erbon_hospedagem_daily ADD COLUMN IF NOT EXISTS status text;

-- ── Segments view diário (diária + segmento + origem) ────────────────────────
CREATE TABLE IF NOT EXISTS erbon_segmentsview_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,          -- dia em que o job capturou
  stay_date     date,                   -- dia da diária
  booking_id    bigint,                 -- bookingID da Erbon
  daily_rate    numeric NOT NULL DEFAULT 0,
  segment       text,
  source        text,
  payload       jsonb NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erbon_segview_hotel_snap
  ON erbon_segmentsview_daily(hotel_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_erbon_segview_hotel_stay
  ON erbon_segmentsview_daily(hotel_id, stay_date);

ALTER TABLE erbon_segmentsview_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "erbon_segmentsview_daily_select" ON erbon_segmentsview_daily FOR SELECT USING (true);
  CREATE POLICY "erbon_segmentsview_daily_insert" ON erbon_segmentsview_daily FOR INSERT WITH CHECK (true);
  CREATE POLICY "erbon_segmentsview_daily_update" ON erbon_segmentsview_daily FOR UPDATE USING (true);
  CREATE POLICY "erbon_segmentsview_daily_delete" ON erbon_segmentsview_daily FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
