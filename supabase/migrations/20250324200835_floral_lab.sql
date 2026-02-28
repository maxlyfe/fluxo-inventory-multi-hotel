/*
  # Add Purchase Tracking System

  1. Changes
    - Add price tracking columns to products
    - Add indexes and policies for purchases
    - Add trigger for price updates
    
  2. Security
    - Update RLS policies
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

-- Create indexes if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_purchases_hotel') THEN
    CREATE INDEX idx_purchases_hotel ON purchases(hotel_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_purchases_date') THEN
    CREATE INDEX idx_purchases_date ON purchases(purchase_date DESC);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_purchase_items_purchase') THEN
    CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_purchase_items_product') THEN
    CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);
  END IF;
END $$;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated read purchases" ON purchases;
DROP POLICY IF EXISTS "Allow inventory manage purchases" ON purchases;
DROP POLICY IF EXISTS "Allow authenticated read purchase_items" ON purchase_items;
DROP POLICY IF EXISTS "Allow inventory manage purchase_items" ON purchase_items;

-- Create new policies
CREATE POLICY "Allow authenticated read purchases"
  ON purchases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory manage purchases"
  ON purchases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

CREATE POLICY "Allow authenticated read purchase_items"
  ON purchase_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory manage purchase_items"
  ON purchase_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

-- Drop existing function and trigger if they exist
DROP TRIGGER IF EXISTS update_product_prices_after_purchase ON purchase_items;
DROP FUNCTION IF EXISTS update_product_prices();

-- Create function to update product prices after purchase
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

-- Create trigger for purchase items
CREATE TRIGGER update_product_prices_after_purchase
  AFTER INSERT ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION update_product_prices();

-- Add comments
COMMENT ON COLUMN products.last_purchase_date IS 'Date of the most recent purchase';
COMMENT ON COLUMN products.last_purchase_price IS 'Price paid in the most recent purchase';
COMMENT ON COLUMN products.average_price IS 'Average purchase price across all purchases';