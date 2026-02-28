/*
  # Products and Governance Stock Setup

  1. New Tables
    - `products`
      - `id` (uuid, primary key)
      - `name` (text)
      - `category` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `governance_stock`
      - `id` (uuid, primary key)
      - `product_id` (uuid, unique, references products)
      - `quantity` (integer)
      - `min_quantity` (integer)
      - `max_quantity` (integer)
      - `initial_balance` (boolean)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Functions
    - `set_governance_initial_balance`: Sets initial balance for governance stock items
    
  3. Security
    - Enable RLS
    - Add policies for secure access
*/

-- Create products table first
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text DEFAULT 'Outros',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Create policies for products
CREATE POLICY "Allow public read products"
  ON products
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated manage products"
  ON products
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

-- Create governance_stock table
CREATE TABLE IF NOT EXISTS governance_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid UNIQUE REFERENCES products(id),
  quantity integer NOT NULL DEFAULT 0,
  min_quantity integer NOT NULL DEFAULT 0,
  max_quantity integer NOT NULL DEFAULT 100,
  initial_balance boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on governance_stock
ALTER TABLE governance_stock ENABLE ROW LEVEL SECURITY;

-- Create policies for governance_stock
CREATE POLICY "Allow authenticated read governance_stock"
  ON governance_stock
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow sup-governanca manage governance_stock"
  ON governance_stock
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'sup-governanca' OR auth_users.role = 'admin')
    )
  );

-- Create function to handle initial balance
CREATE OR REPLACE FUNCTION set_governance_initial_balance(
  p_product_id uuid,
  p_quantity integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO governance_stock (
    product_id,
    quantity,
    initial_balance
  ) VALUES (
    p_product_id,
    p_quantity,
    true
  )
  ON CONFLICT (product_id) DO UPDATE
  SET 
    quantity = p_quantity,
    initial_balance = true,
    updated_at = now();
END;
$$;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_governance_stock_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_governance_stock_timestamp
  BEFORE UPDATE ON governance_stock
  FOR EACH ROW
  EXECUTE FUNCTION update_governance_stock_updated_at();

-- Create trigger to update products updated_at
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_products_timestamp
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- Add comments
COMMENT ON TABLE products IS 'Product catalog for the hotel';
COMMENT ON TABLE governance_stock IS 'Tracks stock levels for governance department';
COMMENT ON FUNCTION set_governance_initial_balance IS 'Sets initial balance for governance stock items';