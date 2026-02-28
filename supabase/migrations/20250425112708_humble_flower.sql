/*
  # Add record_sector_stock_entry function

  1. New Functions
    - record_sector_stock_entry: Function to add inventory items to sector stock
    
  2. Security
    - Function runs with SECURITY DEFINER to ensure proper permissions
    - Validates input parameters
*/

-- Function to record sector stock entry
CREATE OR REPLACE FUNCTION record_sector_stock_entry(
  p_sector_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_hotel_id uuid,
  p_is_custom boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate parameters
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  -- Insert or update sector stock
  INSERT INTO sector_stock (
    sector_id,
    product_id,
    quantity,
    is_custom,
    last_purchase_date,
    last_purchase_quantity,
    hotel_id
  ) VALUES (
    p_sector_id,
    p_product_id,
    p_quantity,
    p_is_custom,
    now(),
    p_quantity,
    p_hotel_id
  )
  ON CONFLICT (sector_id, product_id, hotel_id)
  DO UPDATE SET
    quantity = sector_stock.quantity + p_quantity,
    last_purchase_date = now(),
    last_purchase_quantity = p_quantity,
    updated_at = now();
END;
$$;

-- Add comment
COMMENT ON FUNCTION record_sector_stock_entry IS 'Records new stock entries for sector stock';