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
    last_purchase_quantity = p_quantity;
END;
$$;

-- Function to handle sector requisition delivery
CREATE OR REPLACE FUNCTION handle_sector_requisition_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- Skip custom items that aren't tracked in sector stock
    IF NEW.is_custom THEN
      RETURN NEW;
    END IF;
    
    -- Update sector stock for regular products
    IF NEW.product_id IS NOT NULL OR NEW.substituted_product_id IS NOT NULL THEN
      INSERT INTO sector_stock (
        sector_id,
        product_id,
        quantity,
        hotel_id
      ) VALUES (
        NEW.sector_id,
        COALESCE(NEW.substituted_product_id, NEW.product_id),
        COALESCE(NEW.delivered_quantity, NEW.quantity),
        NEW.hotel_id
      )
      ON CONFLICT (sector_id, product_id, hotel_id)
      DO UPDATE SET
        quantity = sector_stock.quantity + COALESCE(NEW.delivered_quantity, NEW.quantity),
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if trigger exists before creating it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'handle_sector_requisition_delivery'
  ) THEN
    CREATE TRIGGER handle_sector_requisition_delivery
      AFTER UPDATE ON requisitions
      FOR EACH ROW
      EXECUTE FUNCTION handle_sector_requisition_delivery();
  END IF;
END $$;

-- Function to create weekly balance
CREATE OR REPLACE FUNCTION create_sector_weekly_balance(
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
BEGIN
  -- Calculate week dates
  v_week_start := date_trunc('week', now());
  v_week_end := v_week_start + interval '6 days';

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
    p_notes,
    p_hotel_id,
    current_user
  );
END;
$$;

-- Add comments
COMMENT ON FUNCTION record_sector_stock_entry IS 'Records new stock entries for sector stock';
COMMENT ON FUNCTION handle_sector_requisition_delivery IS 'Updates sector stock when requisitions are delivered';
COMMENT ON FUNCTION create_sector_weekly_balance IS 'Creates weekly balance records for sector stock';