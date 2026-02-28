/*
  # Sector Stock Balance Zero Quantity Fix

  1. Changes
    - Add function to handle sector stock balance updates
    - Remove items with zero quantity from sector stock
    - Update sector_weekly_balance to track removed items
    
  2. Security
    - Function runs with SECURITY DEFINER to ensure proper permissions
    - Maintains data integrity while cleaning up unused items
*/

-- Function to handle sector stock balance with zero quantity cleanup
CREATE OR REPLACE FUNCTION handle_sector_stock_balance(
  p_sector_id uuid,
  p_product_id uuid,
  p_final_quantity integer,
  p_hotel_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_initial_quantity integer;
  v_received_quantity integer;
  v_product_name text;
  v_product_category text;
BEGIN
  -- Calculate week dates
  v_week_start := date_trunc('week', now());
  v_week_end := v_week_start + interval '6 days';

  -- Get product details before potentially removing it
  SELECT name, category INTO v_product_name, v_product_category
  FROM products
  WHERE id = p_product_id;

  -- Get initial quantity from previous balance or current stock
  SELECT COALESCE(
    (
      SELECT final_quantity
      FROM sector_weekly_balance
      WHERE sector_id = p_sector_id
      AND product_id = p_product_id
      AND week_end < v_week_start
      ORDER BY week_end DESC
      LIMIT 1
    ),
    (
      SELECT quantity
      FROM sector_stock
      WHERE sector_id = p_sector_id
      AND product_id = p_product_id
      AND hotel_id = p_hotel_id
    ),
    0
  ) INTO v_initial_quantity;

  -- Calculate received quantity for the week (only for non-custom items)
  SELECT COALESCE(SUM(
    CASE 
      WHEN r.status = 'delivered' THEN COALESCE(r.delivered_quantity, r.quantity)
      ELSE 0
    END
  ), 0)
  INTO v_received_quantity
  FROM requisitions r
  WHERE r.sector_id = p_sector_id
  AND r.status = 'delivered'
  AND r.is_custom = false
  AND r.created_at >= v_week_start
  AND r.created_at <= v_week_end
  AND (r.product_id = p_product_id OR r.substituted_product_id = p_product_id);

  -- Create balance record
  INSERT INTO sector_weekly_balance (
    sector_id,
    product_id,
    week_start,
    week_end,
    initial_quantity,
    received_quantity,
    final_quantity,
    notes,
    hotel_id,
    created_by
  ) VALUES (
    p_sector_id,
    p_product_id,
    v_week_start,
    v_week_end,
    v_initial_quantity,
    v_received_quantity,
    p_final_quantity,
    CASE 
      WHEN p_final_quantity = 0 THEN 
        COALESCE(p_notes, '') || ' (Item removido do estoque por quantidade zero)'
      ELSE p_notes
    END,
    p_hotel_id,
    current_user
  );

  -- If final quantity is zero, remove from sector stock
  IF p_final_quantity = 0 THEN
    DELETE FROM sector_stock
    WHERE sector_id = p_sector_id
    AND product_id = p_product_id
    AND hotel_id = p_hotel_id;
    
    -- Log the removal
    RAISE NOTICE 'Removed item % (%) from sector stock due to zero quantity', 
      v_product_name, p_product_id;
  ELSE
    -- Update sector stock with new quantity
    UPDATE sector_stock
    SET 
      quantity = p_final_quantity,
      updated_at = now()
    WHERE sector_id = p_sector_id
    AND product_id = p_product_id
    AND hotel_id = p_hotel_id;
  END IF;
END;
$$;

-- Add comment
COMMENT ON FUNCTION handle_sector_stock_balance IS 'Handles sector stock balance updates and removes items with zero quantity';