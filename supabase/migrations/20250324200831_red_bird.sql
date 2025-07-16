/*
  # Add Missing Purchase Components

  1. Changes
    - Add price tracking columns to products table
    - Create function and trigger for price updates
    - Add comments for documentation
    
  2. Security
    - No changes to RLS policies needed since tables exist
*/

-- Add price tracking columns to products if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'last_purchase_date'
  ) THEN
    ALTER TABLE products
    ADD COLUMN last_purchase_date timestamptz,
    ADD COLUMN last_purchase_price decimal(10,2),
    ADD COLUMN average_price decimal(10,2);
  END IF;
END $$;

-- Function to update product prices after purchase
CREATE OR REPLACE FUNCTION update_product_prices()
RETURNS TRIGGER AS $$
BEGIN
  -- Update product price information
  UPDATE products
  SET 
    last_purchase_date = NEW.created_at,
    last_purchase_price = NEW.unit_price,
    average_price = (
      SELECT ROUND(AVG(unit_price)::numeric, 2)
      FROM purchase_items pi
      WHERE pi.product_id = NEW.product_id
    )
  WHERE id = NEW.product_id;

  -- Create inventory movement for the purchase
  INSERT INTO inventory_movements (
    product_id,
    quantity_change,
    movement_type,
    reason,
    performed_by,
    hotel_id
  ) 
  SELECT 
    NEW.product_id,
    NEW.quantity,
    'entrada',
    'Compra - NF: ' || p.invoice_number,
    current_user,
    p.hotel_id
  FROM purchases p
  WHERE p.id = NEW.purchase_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists and recreate
DROP TRIGGER IF EXISTS update_product_prices_after_purchase ON purchase_items;

CREATE TRIGGER update_product_prices_after_purchase
  AFTER INSERT ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION update_product_prices();

-- Add comments
COMMENT ON TABLE purchases IS 'Records of product purchases with invoice details';
COMMENT ON TABLE purchase_items IS 'Individual items within each purchase';
COMMENT ON COLUMN products.last_purchase_date IS 'Date of the most recent purchase';
COMMENT ON COLUMN products.last_purchase_price IS 'Price paid in the most recent purchase';
COMMENT ON COLUMN products.average_price IS 'Average purchase price across all purchases';