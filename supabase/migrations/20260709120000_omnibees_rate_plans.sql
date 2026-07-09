-- Migration: envio de tarifas para a Omnibees (tela Diretoria → Tarifas Omnibees)
-- Cadastro local dos planos tarifários/tipos de quarto JÁ MAPEADOS na Omnibees
-- (RatePlanCode + InvTypeCode) e log dos envios de preço.

CREATE TABLE IF NOT EXISTS omnibees_rate_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name           text NOT NULL,               -- nome amigável (ex.: "BAR — Standard")
  rate_plan_code text NOT NULL,               -- RatePlanCode na Omnibees
  inv_type_code  text NOT NULL,               -- código do tipo de quarto na Omnibees
  currency       text NOT NULL DEFAULT 'BRL',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id, rate_plan_code, inv_type_code)
);

CREATE TABLE IF NOT EXISTS omnibees_rate_send_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  rate_plan_code text NOT NULL,
  inv_type_code  text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  prices         jsonb NOT NULL,              -- [{guests, amount}], child, allotment
  success        boolean NOT NULL,
  error          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omnibees_rate_send_log_hotel
  ON omnibees_rate_send_log(hotel_id, created_at DESC);

-- ── RLS (padrão permissivo do projeto) ───────────────────────────────────────
ALTER TABLE omnibees_rate_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE omnibees_rate_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "omnibees_rate_plans_select" ON omnibees_rate_plans FOR SELECT USING (true);
CREATE POLICY "omnibees_rate_plans_insert" ON omnibees_rate_plans FOR INSERT WITH CHECK (true);
CREATE POLICY "omnibees_rate_plans_update" ON omnibees_rate_plans FOR UPDATE USING (true);
CREATE POLICY "omnibees_rate_plans_delete" ON omnibees_rate_plans FOR DELETE USING (true);

CREATE POLICY "omnibees_rate_send_log_select" ON omnibees_rate_send_log FOR SELECT USING (true);
CREATE POLICY "omnibees_rate_send_log_insert" ON omnibees_rate_send_log FOR INSERT WITH CHECK (true);
CREATE POLICY "omnibees_rate_send_log_delete" ON omnibees_rate_send_log FOR DELETE USING (true);
