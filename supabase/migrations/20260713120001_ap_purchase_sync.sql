-- Purchases -> Accounts Payable sync
-- Trigger keeps ap_titles (origin='purchase') in sync with purchases.
-- Backfill at the end reuses the same function for retroactive parity.

CREATE OR REPLACE FUNCTION fn_sync_purchase_ap(p purchases)
RETURNS void AS $$
DECLARE
  v_count integer;
  v_base_due date;
  v_installment numeric(14,2);
  v_last numeric(14,2);
  v_supplier_name text;
  i integer;
BEGIN
  IF p.hotel_id IS NULL OR COALESCE(p.total_amount, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Never touch installments that already have payments
  DELETE FROM ap_titles
  WHERE origin = 'purchase' AND origin_id = p.id AND amount_paid = 0;

  v_count := CASE WHEN COALESCE(p.is_installment, false) AND COALESCE(p.installment_count, 1) > 1
                  THEN p.installment_count ELSE 1 END;
  v_base_due := COALESCE(p.due_date, p.emission_date + 30, (p.created_at::date) + 30);
  v_installment := round(p.total_amount / v_count, 2);
  v_last := p.total_amount - v_installment * (v_count - 1);
  v_supplier_name := COALESCE(NULLIF(p.supplier, ''), 'Fornecedor');

  FOR i IN 1..v_count LOOP
    INSERT INTO ap_titles (
      hotel_id, description, supplier_id, chart_account_sub_id,
      origin, origin_id, installment_number, installment_total,
      amount, issue_date, due_date, notes
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
      (v_base_due + (i - 1) * interval '1 month')::date,
      NULL
    )
    ON CONFLICT (origin, origin_id, installment_number)
    DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_trg_sync_purchase_ap()
RETURNS trigger AS $$
BEGIN
  PERFORM fn_sync_purchase_ap(NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_purchase_ap ON purchases;
CREATE TRIGGER trg_sync_purchase_ap
  AFTER INSERT OR UPDATE OF total_amount, due_date, is_installment, installment_count, supplier_id, chart_account_sub_id
  ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_trg_sync_purchase_ap();

-- Cleanup when a purchase is deleted (keep paid history? no: cascade delete unpaid, keep paid)
CREATE OR REPLACE FUNCTION fn_trg_delete_purchase_ap()
RETURNS trigger AS $$
BEGIN
  DELETE FROM ap_titles WHERE origin = 'purchase' AND origin_id = OLD.id AND amount_paid = 0;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_purchase_ap ON purchases;
CREATE TRIGGER trg_delete_purchase_ap
  BEFORE DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION fn_trg_delete_purchase_ap();

-- Backfill existing purchases
SELECT fn_sync_purchase_ap(p) FROM purchases p WHERE COALESCE(p.total_amount, 0) > 0;
