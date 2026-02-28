/*
  # Purchase Management System

  1. New Tables
    - `purchase_orders`
      - `id` (uuid, primary key)
      - `status` (text) - 'draft', 'pending', 'received', 'archived'
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
      - `hotel_id` (uuid)
      - `notes` (text)
      - `expected_date` (timestamp)
      - `received_date` (timestamp)
      
    - `purchase_order_items`
      - `id` (uuid, primary key)
      - `purchase_order_id` (uuid)
      - `product_id` (uuid)
      - `quantity` (integer)
      - `last_price` (decimal)
      - `quoted_price` (decimal)
      - `status` (text) - 'pending', 'received', 'not_received'
      - `notes` (text)
      - `last_purchase_date` (timestamp)

  2. Security
    - Enable RLS
    - Add policies for inventory management
*/

-- Create purchase_orders table
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'received', 'archived')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  hotel_id uuid REFERENCES hotels(id) NOT NULL,
  notes text,
  expected_date timestamptz,
  received_date timestamptz
);

-- Create purchase_order_items table
CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  quantity integer NOT NULL,
  last_price decimal(10,2),
  quoted_price decimal(10,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'not_received')),
  notes text,
  last_purchase_date timestamptz
);

-- Create indexes
CREATE INDEX idx_purchase_orders_hotel ON purchase_orders(hotel_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_dates ON purchase_orders(expected_date, received_date);
CREATE INDEX idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_product ON purchase_order_items(product_id);
CREATE INDEX idx_purchase_order_items_status ON purchase_order_items(status);

-- Enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow authenticated read purchase_orders"
  ON purchase_orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory manage purchase_orders"
  ON purchase_orders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

CREATE POLICY "Allow authenticated read purchase_order_items"
  ON purchase_order_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory manage purchase_order_items"
  ON purchase_order_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION update_purchase_order_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for timestamp updates
CREATE TRIGGER update_purchase_order_timestamp
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_timestamp();

-- Add comments
COMMENT ON TABLE purchase_orders IS 'Purchase orders for inventory management';
COMMENT ON TABLE purchase_order_items IS 'Individual items within purchase orders';
COMMENT ON COLUMN purchase_orders.status IS 'Status of the purchase order: draft, pending, received, or archived';
COMMENT ON COLUMN purchase_order_items.status IS 'Status of the item: pending, received, or not_received';