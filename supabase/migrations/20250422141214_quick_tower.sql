/*
  # Add Sector Stock Management

  1. Changes
    - Add tables if they don't exist
    - Add indexes and policies
    - Add trigger for requisition delivery
*/

-- Create tables if they don't exist
DO $$ 
BEGIN
  -- Create sector_stock table if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sector_stock') THEN
    CREATE TABLE sector_stock (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sector_id uuid REFERENCES sectors(id),
      product_id uuid REFERENCES products(id),
      quantity integer NOT NULL DEFAULT 0,
      min_quantity integer NOT NULL DEFAULT 0,
      max_quantity integer NOT NULL DEFAULT 100,
      hotel_id uuid REFERENCES hotels(id) NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(sector_id, product_id, hotel_id)
    );
  END IF;

  -- Create sector_stock_balance table if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sector_stock_balance') THEN
    CREATE TABLE sector_stock_balance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sector_id uuid REFERENCES sectors(id),
      product_id uuid REFERENCES products(id),
      previous_quantity integer NOT NULL,
      current_quantity integer NOT NULL,
      received_quantity integer NOT NULL DEFAULT 0,
      consumed_quantity integer GENERATED ALWAYS AS (
        previous_quantity + received_quantity - current_quantity
      ) STORED,
      balance_date timestamptz NOT NULL,
      notes text,
      hotel_id uuid REFERENCES hotels(id) NOT NULL,
      created_at timestamptz DEFAULT now(),
      created_by text NOT NULL
    );
  END IF;
END $$;

-- Create indexes if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_stock_sector') THEN
    CREATE INDEX idx_sector_stock_sector ON sector_stock(sector_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_stock_product') THEN
    CREATE INDEX idx_sector_stock_product ON sector_stock(product_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_stock_hotel') THEN
    CREATE INDEX idx_sector_stock_hotel ON sector_stock(hotel_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_balance_sector') THEN
    CREATE INDEX idx_sector_balance_sector ON sector_stock_balance(sector_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_balance_date') THEN
    CREATE INDEX idx_sector_balance_date ON sector_stock_balance(balance_date DESC);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sector_balance_hotel') THEN
    CREATE INDEX idx_sector_balance_hotel ON sector_stock_balance(hotel_id);
  END IF;
END $$;

-- Enable RLS if not already enabled
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'sector_stock' 
    AND rowsecurity = true
  ) THEN
    ALTER TABLE sector_stock ENABLE ROW LEVEL SECURITY;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'sector_stock_balance' 
    AND rowsecurity = true
  ) THEN
    ALTER TABLE sector_stock_balance ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated read sector_stock" ON sector_stock;
DROP POLICY IF EXISTS "Allow sector manage own stock" ON sector_stock;
DROP POLICY IF EXISTS "Allow authenticated read sector_balance" ON sector_stock_balance;
DROP POLICY IF EXISTS "Allow sector manage own balance" ON sector_stock_balance;

-- Create new policies
CREATE POLICY "Allow authenticated read sector_stock"
  ON sector_stock FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow sector manage own stock"
  ON sector_stock FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (
        auth_users.role = 'admin' OR 
        auth_users.role = 'inventory' OR
        auth_users.role = 'sup-governanca'
      )
    )
  );

CREATE POLICY "Allow authenticated read sector_balance"
  ON sector_stock_balance FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow sector manage own balance"
  ON sector_stock_balance FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (
        auth_users.role = 'admin' OR 
        auth_users.role = 'inventory' OR
        auth_users.role = 'sup-governanca'
      )
    )
  );

-- Drop existing function and trigger if they exist
DROP TRIGGER IF EXISTS handle_sector_requisition_delivery ON requisitions;
DROP FUNCTION IF EXISTS handle_sector_requisition_delivery();

-- Create function to handle requisition delivery to sector
CREATE OR REPLACE FUNCTION handle_sector_requisition_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_sector_id uuid;
  v_hotel_id uuid;
BEGIN
  -- Only proceed if this is a delivery
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- Get sector and hotel info
    SELECT sector_id, hotel_id INTO v_sector_id, v_hotel_id
    FROM requisitions
    WHERE id = NEW.id;

    -- Update or create sector stock
    INSERT INTO sector_stock (
      sector_id,
      product_id,
      quantity,
      hotel_id
    ) VALUES (
      v_sector_id,
      NEW.product_id,
      COALESCE(NEW.delivered_quantity, NEW.quantity),
      v_hotel_id
    )
    ON CONFLICT (sector_id, product_id, hotel_id)
    DO UPDATE SET
      quantity = sector_stock.quantity + COALESCE(NEW.delivered_quantity, NEW.quantity),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for requisition delivery
CREATE TRIGGER handle_sector_requisition_delivery
  AFTER UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION handle_sector_requisition_delivery();

-- Add comments
COMMENT ON TABLE sector_stock IS 'Tracks inventory levels for specific sectors';
COMMENT ON TABLE sector_stock_balance IS 'Records periodic inventory counts and consumption';