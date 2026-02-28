/*
  # Fix Products RLS Policies

  1. Changes
    - Drop existing RLS policies for products table
    - Create new policies with proper authentication checks
    - Add policy for inventory movements
    
  2. Security
    - Allow public read access
    - Restrict management to authenticated users with proper roles
    - Use auth.uid() for role verification
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow public read products" ON products;
DROP POLICY IF EXISTS "Allow authenticated manage products" ON products;

-- Create new policies
CREATE POLICY "Allow public read products"
  ON products
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow inventory management"
  ON products
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

-- Create inventory movements table for tracking stock changes
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  quantity_change integer NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('entrada', 'saida', 'ajuste')),
  reason text,
  performed_by text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on inventory movements
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Create policies for inventory movements
CREATE POLICY "Allow authenticated read movements"
  ON inventory_movements
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory create movements"
  ON inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

COMMENT ON TABLE inventory_movements IS 'Tracks all changes to product stock levels';