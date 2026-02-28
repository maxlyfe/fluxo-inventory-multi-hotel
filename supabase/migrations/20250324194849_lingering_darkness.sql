/*
  # Add Purchase Tracking System

  1. New Tables
    - `purchases`
      - `id` (uuid, primary key)
      - `invoice_number` (text)
      - `supplier` (text)
      - `purchase_date` (timestamp)
      - `total_amount` (decimal)
      - `notes` (text)
      - `created_at` (timestamp)
      - `hotel_id` (uuid)

    - `purchase_items`
      - `id` (uuid, primary key)
      - `purchase_id` (uuid)
      - `product_id` (uuid)
      - `quantity` (integer)
      - `unit_price` (decimal)
      - `total_price` (decimal)
      - `created_at` (timestamp)

  2. Changes to Products Table
    - Add columns for price tracking
    - Add function to calculate average price

  3. Security
    - Enable RLS
    - Add policies for inventory management
*/

-- Create purchases table
CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text,
  supplier text,
  purchase_date timestamptz NOT NULL,
  total_amount decimal(10,2) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  hotel_id uuid REFERENCES hotels(id) NOT NULL
);

-- Create purchase_items table
CREATE TABLE purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price decimal(10,2) NOT NULL,
  total_price decimal(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add price tracking columns to products
ALTER TABLE products
ADD COLUMN last_purchase_date timestamptz,
ADD COLUMN last_purchase_price decimal(10,2),
ADD COLUMN average_price decimal(10,2);

-- Create indexes
CREATE INDEX idx_purchases_hotel ON purchases(hotel_id);
CREATE INDEX idx_purchases_date ON purchases(purchase_date DESC);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);

-- Enable RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

-- Create policies
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

-- Create trigger for purchase items
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