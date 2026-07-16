-- Fix fn_sync_purchase_ap trigger function to avoid "record v_card is not assigned yet" error
-- The error occurred because v_card (declared as RECORD) was accessed (v_card.closing_day)
-- in the CASE statement even when it was never assigned a row (which happens when credit_card_id is NULL).

CREATE OR REPLACE FUNCTION fn_sync_purchase_ap(p purchases)
RETURNS void AS $$
DECLARE
  v_count integer;
  v_base_due date;
  v_installment numeric(14,2);
  v_last numeric(14,2);
  v_supplier_name text;
  v_card_closing_day integer;
  v_card_due_day integer;
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
    SELECT closing_day, due_day INTO v_card_closing_day, v_card_due_day FROM credit_cards WHERE id = p.credit_card_id;
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
            v_card_closing_day,
            v_card_due_day,
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
