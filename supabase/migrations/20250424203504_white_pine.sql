/*
  # Add Financial Management Functions

  1. New Functions
    - update_hotel_balance: Updates hotel balance with a new transaction
    
  2. Security
    - Function runs with SECURITY DEFINER to ensure proper permissions
    - Validates input parameters
*/

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
  -- Validate parameters
  IF p_transaction_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid transaction type. Must be "credit" or "debit".';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero.';
  END IF;

  IF p_reference_type NOT IN ('purchase', 'transfer', 'consumption', 'payment') THEN
    RAISE EXCEPTION 'Invalid reference type. Must be "purchase", "transfer", "consumption", or "payment".';
  END IF;

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

-- Add comment
COMMENT ON FUNCTION update_hotel_balance IS 'Updates hotel balance with a new transaction';