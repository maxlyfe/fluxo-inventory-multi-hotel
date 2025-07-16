/*
  # Add Bar Piscina and Update Sector Stock System

  1. Changes
    - Add Bar Piscina sector
    - Add custom_item flag to sector_stock
    - Add purchase_date to track stock entries
    - Add weekly balance tracking
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add Bar Piscina sector
INSERT INTO sectors (
  name,
  role,
  hotel_id,
  can_manage_requests
) VALUES (
  'Bar Piscina',
  'restaurant',
  '11111111-1111-1111-1111-111111111111',
  true
);

-- Add columns to sector_stock for custom items
ALTER TABLE sector_stock
ADD COLUMN IF NOT EXISTS is_custom boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_purchase_date timestamptz,
ADD COLUMN IF NOT EXISTS last_purchase_quantity integer;

-- Create weekly balance table for sectors
CREATE TABLE IF NOT EXISTS sector_weekly_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid REFERENCES sectors(id),
  product_id uuid REFERENCES products(id),
  week_start timestamptz NOT NULL,
  week_end timestamptz NOT NULL,
  initial_quantity integer NOT NULL,
  received_quantity integer NOT NULL DEFAULT 0,
  final_quantity integer NOT NULL,
  consumed_quantity integer GENERATED ALWAYS AS (
    initial_quantity + received_quantity - final_quantity
  ) STORED,
  notes text,
  hotel_id uuid REFERENCES hotels(id) NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sector_weekly_balance_sector
ON sector_weekly_balance(sector_id);

CREATE INDEX IF NOT EXISTS idx_sector_weekly_balance_dates
ON sector_weekly_balance(week_start, week_end);

CREATE INDEX IF NOT EXISTS idx_sector_weekly_balance_hotel
ON sector_weekly_balance(hotel_id);

-- Enable RLS
ALTER TABLE sector_weekly_balance ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow authenticated read sector_weekly_balance"
  ON sector_weekly_balance FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow sector manage own weekly balance"
  ON sector_weekly_balance FOR ALL
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

-- Add comments
COMMENT ON TABLE sector_weekly_balance IS 'Weekly balance tracking for sector stock';
COMMENT ON COLUMN sector_stock.is_custom IS 'Indicates if this is a custom item specific to the sector';
COMMENT ON COLUMN sector_stock.last_purchase_date IS 'Date of the last stock entry';
COMMENT ON COLUMN sector_stock.last_purchase_quantity IS 'Quantity of the last stock entry';