-- ── Módulo Contabilidade ────────────────────────────────────────────────────
-- Adds NCM to purchase_items, supplier_id FK to purchases,
-- and creates the IBS/CBS credit-usage tracking table.

-- 1. NCM per purchase item
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS ncm TEXT;

-- 2. Supplier FK on purchases (optional link to suppliers table)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases(supplier_id);

-- 3. IBS/CBS credit usage records
--    Credits are computed on-the-fly from purchases; only usage is stored.
CREATE TABLE IF NOT EXISTS accounting_ibs_cbs_usage (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID         NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  usage_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
  period_month   INTEGER      NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year    INTEGER      NOT NULL CHECK (period_year >= 2024),
  ibs_used       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (ibs_used >= 0),
  cbs_used       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cbs_used >= 0),
  description    TEXT,
  created_by     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE accounting_ibs_cbs_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ibs_cbs_usage_select" ON accounting_ibs_cbs_usage
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ibs_cbs_usage_insert" ON accounting_ibs_cbs_usage
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ibs_cbs_usage_update" ON accounting_ibs_cbs_usage
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ibs_cbs_usage_delete" ON accounting_ibs_cbs_usage
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ibs_cbs_usage_hotel_id ON accounting_ibs_cbs_usage(hotel_id);
CREATE INDEX IF NOT EXISTS idx_ibs_cbs_usage_period   ON accounting_ibs_cbs_usage(period_year, period_month);
