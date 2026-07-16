-- Credit Cards + Payment Method on Purchases
-- Creates: credit_cards table
-- Alters: purchases (payment_method, credit_card_id, source_hotel_id)
-- Alters: ap_titles (credit_card_id, competencia_date)
-- Updates: fn_sync_purchase_ap trigger to propagate card data

-- 1. Credit cards table
CREATE TABLE IF NOT EXISTS credit_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name          text NOT NULL,
  last_4_digits text NOT NULL CHECK (length(last_4_digits) = 4),
  card_brand    text CHECK (card_brand IN ('visa','master','elo','amex','hipercard','outros')),
  closing_day   integer NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day       integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_cards_hotel ON credit_cards(hotel_id);

ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_cards_all_authenticated" ON credit_cards;
CREATE POLICY "credit_cards_all_authenticated" ON credit_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Add payment_method, credit_card_id, source_hotel_id to purchases
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IN ('cartao','boleto','pix','transferencia','dinheiro')),
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES credit_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_hotel_id uuid REFERENCES hotels(id) ON DELETE SET NULL;

-- 3. Add credit_card_id and competencia_date to ap_titles
ALTER TABLE ap_titles
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES credit_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competencia_date date;

-- 4. Helper: calculate card due date in SQL
CREATE OR REPLACE FUNCTION fn_card_due_date(
  p_purchase_date date,
  p_closing_day integer,
  p_due_day integer,
  p_installment_index integer DEFAULT 0
) RETURNS date AS $$
DECLARE
  v_purchase_day integer;
  v_base_month date;
  v_due date;
BEGIN
  v_purchase_day := EXTRACT(DAY FROM p_purchase_date);

  IF v_purchase_day <= p_closing_day THEN
    v_base_month := date_trunc('month', p_purchase_date) + interval '1 month';
  ELSE
    v_base_month := date_trunc('month', p_purchase_date) + interval '2 months';
  END IF;

  v_base_month := v_base_month + (p_installment_index * interval '1 month');

  v_due := (v_base_month + ((p_due_day - 1) * interval '1 day'))::date;
  RETURN v_due;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overload for timestamptz (trigger passes timestamptz)
CREATE OR REPLACE FUNCTION fn_card_due_date(
  p_purchase_date timestamptz,
  p_closing_day integer,
  p_due_day integer,
  p_installment_index integer DEFAULT 0
) RETURNS date AS $$
BEGIN
  RETURN fn_card_due_date(p_purchase_date::date, p_closing_day, p_due_day, p_installment_index);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 5. Update fn_sync_purchase_ap to propagate card data
CREATE OR REPLACE FUNCTION fn_sync_purchase_ap(p purchases)
RETURNS void AS $$
DECLARE
  v_count integer;
  v_base_due date;
  v_installment numeric(14,2);
  v_last numeric(14,2);
  v_supplier_name text;
  v_card record;
  v_use_card boolean := false;
  i integer;
BEGIN
  IF p.hotel_id IS NULL OR COALESCE(p.total_amount, 0) <= 0 THEN
    RETURN;
  END IF;

  DELETE FROM ap_titles
  WHERE origin = 'purchase' AND origin_id = p.id AND amount_paid = 0;

  v_count := CASE WHEN COALESCE(p.is_installment, false) AND COALESCE(p.installment_count, 1) > 1
                  THEN p.installment_count ELSE 1 END;

  IF p.credit_card_id IS NOT NULL THEN
    SELECT closing_day, due_day INTO v_card FROM credit_cards WHERE id = p.credit_card_id;
    IF FOUND THEN
      v_use_card := true;
    END IF;
  END IF;

  IF NOT v_use_card THEN
    v_base_due := COALESCE(p.due_date, p.emission_date + 30, (p.created_at::date) + 30);
  END IF;

  v_installment := round(p.total_amount / v_count, 2);
  v_last := p.total_amount - v_installment * (v_count - 1);
  v_supplier_name := COALESCE(NULLIF(p.supplier, ''), 'Fornecedor');

  FOR i IN 1..v_count LOOP
    INSERT INTO ap_titles (
      hotel_id, description, supplier_id, chart_account_sub_id,
      origin, origin_id, installment_number, installment_total,
      amount, issue_date, due_date, credit_card_id, competencia_date, notes
    ) VALUES (
      p.hotel_id,
      'Compra ' || COALESCE(NULLIF(p.invoice_number, ''), '') || ' - ' || v_supplier_name,
      p.supplier_id,
      p.chart_account_sub_id,
      'purchase',
      p.id,
      i,
      v_count,
      CASE WHEN i = v_count THEN v_last ELSE v_installment END,
      COALESCE(p.emission_date, p.purchase_date, p.created_at::date),
      CASE
        WHEN v_use_card THEN
          fn_card_due_date(
            COALESCE(p.purchase_date, p.created_at::date),
            v_card.closing_day,
            v_card.due_day,
            i - 1
          )
        ELSE
          (v_base_due + (i - 1) * interval '1 month')::date
      END,
      p.credit_card_id,
      COALESCE(p.purchase_date, p.created_at::date),
      NULL
    )
    ON CONFLICT (origin, origin_id, installment_number)
    DO UPDATE SET
      due_date = EXCLUDED.due_date,
      amount = EXCLUDED.amount,
      credit_card_id = EXCLUDED.credit_card_id,
      competencia_date = EXCLUDED.competencia_date,
      supplier_id = EXCLUDED.supplier_id,
      chart_account_sub_id = EXCLUDED.chart_account_sub_id,
      description = EXCLUDED.description,
      installment_total = EXCLUDED.installment_total;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 6. Recreate trigger with new watched columns
DROP TRIGGER IF EXISTS trg_sync_purchase_ap ON purchases;
CREATE TRIGGER trg_sync_purchase_ap
  AFTER INSERT OR UPDATE OF total_amount, due_date, is_installment, installment_count,
    supplier_id, chart_account_sub_id, credit_card_id, payment_method
  ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_trg_sync_purchase_ap();

-- 7. Backfill competencia_date on existing ap_titles from purchases
UPDATE ap_titles SET competencia_date = (
  SELECT COALESCE(p.purchase_date, p.created_at::date)
  FROM purchases p WHERE p.id = ap_titles.origin_id
)
WHERE origin = 'purchase' AND competencia_date IS NULL AND origin_id IS NOT NULL;
