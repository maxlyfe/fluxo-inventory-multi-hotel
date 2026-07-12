-- Migration: automação diária do Pick-up Report (8h BRT via Netlify scheduled function)
-- 1. Garante a tabela diretoria_pickup_snapshots (criada originalmente direto no banco,
--    sem migration local) para ambientes novos.
-- 2. Cria erbon_hospedagem_daily: captura diária do endpoint /hotel/{id}/hospedagem
--    da Erbon — dia a dia, valores e características de cada reserva, base futura
--    para análise das diárias vendidas.

-- ── Snapshots OTB do Pick-up Report ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diretoria_pickup_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  snapshot_date    date NOT NULL,
  stay_date        date NOT NULL,
  rooms_otb        integer NOT NULL DEFAULT 0,
  net_room_revenue numeric NOT NULL DEFAULT 0,
  adr              numeric NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, snapshot_date, stay_date)
);

CREATE INDEX IF NOT EXISTS idx_pickup_snapshots_hotel_snap
  ON diretoria_pickup_snapshots(hotel_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_pickup_snapshots_hotel_stay
  ON diretoria_pickup_snapshots(hotel_id, stay_date);

ALTER TABLE diretoria_pickup_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "diretoria_pickup_snapshots_select" ON diretoria_pickup_snapshots FOR SELECT USING (true);
  CREATE POLICY "diretoria_pickup_snapshots_insert" ON diretoria_pickup_snapshots FOR INSERT WITH CHECK (true);
  CREATE POLICY "diretoria_pickup_snapshots_update" ON diretoria_pickup_snapshots FOR UPDATE USING (true);
  CREATE POLICY "diretoria_pickup_snapshots_delete" ON diretoria_pickup_snapshots FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Hospedagem diária (Erbon /hotel/{id}/hospedagem) ─────────────────────────
CREATE TABLE IF NOT EXISTS erbon_hospedagem_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  snapshot_date       date NOT NULL,          -- dia em que o job capturou
  stay_date           date,                   -- dia da diária (quando identificável no payload)
  booking_internal_id bigint,                 -- reserva (quando identificável no payload)
  payload             jsonb NOT NULL,         -- registro completo devolvido pela Erbon
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erbon_hospedagem_hotel_snap
  ON erbon_hospedagem_daily(hotel_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_erbon_hospedagem_hotel_stay
  ON erbon_hospedagem_daily(hotel_id, stay_date);
CREATE INDEX IF NOT EXISTS idx_erbon_hospedagem_booking
  ON erbon_hospedagem_daily(hotel_id, booking_internal_id);

ALTER TABLE erbon_hospedagem_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "erbon_hospedagem_daily_select" ON erbon_hospedagem_daily FOR SELECT USING (true);
  CREATE POLICY "erbon_hospedagem_daily_insert" ON erbon_hospedagem_daily FOR INSERT WITH CHECK (true);
  CREATE POLICY "erbon_hospedagem_daily_update" ON erbon_hospedagem_daily FOR UPDATE USING (true);
  CREATE POLICY "erbon_hospedagem_daily_delete" ON erbon_hospedagem_daily FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
