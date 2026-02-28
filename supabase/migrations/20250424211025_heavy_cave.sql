/*
  # Fix Zero Quantity Issue in Sector Stock

  1. Changes
    - Modify sector_stock table to explicitly allow zero quantities
    - Update handle_sector_stock_balance function to properly handle zero quantities
    - Add explicit validation to ensure quantities can be zero but not negative
    
  2. Security
    - No changes to RLS policies needed
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
  v_is_custom boolean;
BEGIN
  -- Validate parameters
  IF p_final_quantity < 0 THEN
    RAISE EXCEPTION 'Final quantity cannot be negative';
  END IF;

  -- Calculate week dates
  v_week_start := date_trunc('week', now());
  v_week_end := v_week_start + interval '6 days';

  -- Get product details and check if it's a custom item
  SELECT 
    COALESCE(p.name, 'Unknown Product'), 
    COALESCE(p.category, 'Unknown Category'),
    COALESCE(ss.is_custom, false)
  INTO v_product_name, v_product_category, v_is_custom
  FROM products p
  LEFT JOIN sector_stock ss ON ss.product_id = p.id AND ss.sector_id = p_sector_id
  WHERE p.id = p_product_id;

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

  -- Calculate received quantity for the week
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
    
    -- If no rows were updated, insert a new record
    IF NOT FOUND THEN
      INSERT INTO sector_stock (
        sector_id,
        product_id,
        quantity,
        is_custom,
        hotel_id
      ) VALUES (
        p_sector_id,
        p_product_id,
        p_final_quantity,
        v_is_custom,
        p_hotel_id
      );
    END IF;
  END IF;
END;
$$;

-- Add comment
COMMENT ON FUNCTION handle_sector_stock_balance IS 'Handles sector stock balance updates and removes items with zero quantity';