/*
  # Financial Control Functions

  1. Functions
    - record_purchase_payment: Records payment from a hotel for a purchase
    - update_product_cost: Updates product cost history
    - record_transfer_cost: Records costs for hotel transfers
    - update_hotel_balance: Updates hotel balance
    
  2. Triggers
    - Automatically update balances on payments
    - Automatically update costs on purchases
    - Automatically handle transfer costs
*/

-- Function to record purchase payment
CREATE OR REPLACE FUNCTION record_purchase_payment(
  p_purchase_id uuid,
  p_hotel_id uuid,
  p_amount decimal(10,2),
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance decimal(10,2);
BEGIN
  -- Get current balance
  SELECT COALESCE(MAX(balance), 0)
  INTO v_current_balance
  FROM hotel_balances
  WHERE hotel_id = p_hotel_id;

  -- Record payment
  INSERT INTO purchase_payments (
    purchase_id,
    hotel_id,
    amount,
    notes,
    created_by
  ) VALUES (
    p_purchase_id,
    p_hotel_id,
    p_amount,
    p_notes,
    current_user
  );

  -- Update hotel balance
  INSERT INTO hotel_balances (
    hotel_id,
    transaction_type,
    amount,
    reason,
    reference_type,
    reference_id,
    balance,
    created_by
  ) VALUES (
    p_hotel_id,
    'debit',
    p_amount,
    'Pagamento de compra',
    'purchase',
    p_purchase_id,
    v_current_balance - p_amount,
    current_user
  );
END;
$$;

-- Function to update product cost
CREATE OR REPLACE FUNCTION update_product_cost(
  p_product_id uuid,
  p_unit_cost decimal(10,2),
  p_source_type text,
  p_source_id uuid,
  p_hotel_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO product_costs (
    product_id,
    cost_date,
    unit_cost,
    source_type,
    source_id,
    hotel_id
  ) VALUES (
    p_product_id,
    now(),
    p_unit_cost,
    p_source_type,
    p_source_id,
    p_hotel_id
  );
END;
$$;

-- Function to record transfer cost
CREATE OR REPLACE FUNCTION record_transfer_cost(
  p_transfer_id uuid,
  p_unit_cost decimal(10,2)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_hotel_id uuid;
  v_dest_hotel_id uuid;
  v_quantity integer;
  v_total_cost decimal(10,2);
  v_source_balance decimal(10,2);
  v_dest_balance decimal(10,2);
BEGIN
  -- Get transfer details
  SELECT 
    source_hotel_id,
    destination_hotel_id,
    quantity,
    quantity * p_unit_cost
  INTO 
    v_source_hotel_id,
    v_dest_hotel_id,
    v_quantity,
    v_total_cost
  FROM hotel_transfers
  WHERE id = p_transfer_id;

  -- Get current balances
  SELECT COALESCE(MAX(balance), 0)
  INTO v_source_balance
  FROM hotel_balances
  WHERE hotel_id = v_source_hotel_id;

  SELECT COALESCE(MAX(balance), 0)
  INTO v_dest_balance
  FROM hotel_balances
  WHERE hotel_id = v_dest_hotel_id;

  -- Update source hotel balance (credit)
  INSERT INTO hotel_balances (
    hotel_id,
    transaction_type,
    amount,
    reason,
    reference_type,
    reference_id,
    balance,
    created_by
  ) VALUES (
    v_source_hotel_id,
    'credit',
    v_total_cost,
    'Transferência de produtos (saída)',
    'transfer',
    p_transfer_id,
    v_source_balance + v_total_cost,
    current_user
  );

  -- Update destination hotel balance (debit)
  INSERT INTO hotel_balances (
    hotel_id,
    transaction_type,
    amount,
    reason,
    reference_type,
    reference_id,
    balance,
    created_by
  ) VALUES (
    v_dest_hotel_id,
    'debit',
    v_total_cost,
    'Transferência de produtos (entrada)',
    'transfer',
    p_transfer_id,
    v_dest_balance - v_total_cost,
    current_user
  );

  -- Update transfer with cost
  UPDATE hotel_transfers
  SET unit_cost = p_unit_cost
  WHERE id = p_transfer_id;
END;
$$;

-- Function to update hotel balance
CREATE OR REPLACE FUNCTION update_hotel_balance(
  p_hotel_id uuid,
  p_transaction_type text,
  p_amount decimal(10,2),
  p_reason text,
  p_reference_type text,
  p_reference_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance decimal(10,2);
BEGIN
  -- Get current balance
  SELECT COALESCE(MAX(balance), 0)
  INTO v_current_balance
  FROM hotel_balances
  WHERE hotel_id = p_hotel_id;

  -- Calculate new balance
  v_current_balance := CASE p_transaction_type
    WHEN 'credit' THEN v_current_balance + p_amount
    WHEN 'debit' THEN v_current_balance - p_amount
  END;

  -- Record transaction
  INSERT INTO hotel_balances (
    hotel_id,
    transaction_type,
    amount,
    reason,
    reference_type,
    reference_id,
    balance,
    created_by
  ) VALUES (
    p_hotel_id,
    p_transaction_type,
    p_amount,
    p_reason,
    p_reference_type,
    p_reference_id,
    v_current_balance,
    current_user
  );
END;
$$;

-- Add comments
COMMENT ON FUNCTION record_purchase_payment IS 'Records payment from a hotel for a purchase and updates balance';
COMMENT ON FUNCTION update_product_cost IS 'Updates product cost history';
COMMENT ON FUNCTION record_transfer_cost IS 'Records costs for hotel transfers and updates balances';
COMMENT ON FUNCTION update_hotel_balance IS 'Updates hotel balance with a new transaction';