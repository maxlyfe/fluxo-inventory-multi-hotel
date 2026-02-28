/*
  # Financial Control System Setup

  1. New Tables
    - `hotel_balances`
      - Tracks financial balance for each hotel
      - Records all credits and debits
      - Maintains running balance
    
    - `purchase_payments`
      - Records how much each hotel paid for purchases
      - Links to purchases table
      
    - `product_costs`
      - Tracks cost history for products
      - Used for calculating transfer values

  2. Changes to Existing Tables
    - Add cost tracking to hotel_transfers
    - Add financial impact tracking to inventory_movements

  3. Security
    - Enable RLS
    - Add policies for financial management
*/

-- Create hotel_balances table
CREATE TABLE hotel_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('credit', 'debit')),
  amount decimal(10,2) NOT NULL,
  reason text NOT NULL,
  reference_type text NOT NULL CHECK (reference_type IN ('purchase', 'transfer', 'consumption')),
  reference_id uuid NOT NULL,
  balance decimal(10,2) NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL
);

-- Create purchase_payments table
CREATE TABLE purchase_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid REFERENCES purchases(id) NOT NULL,
  hotel_id uuid REFERENCES hotels(id) NOT NULL,
  amount decimal(10,2) NOT NULL,
  payment_date timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL,
  UNIQUE(purchase_id, hotel_id)
);

-- Create product_costs table
CREATE TABLE product_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  cost_date timestamptz NOT NULL,
  unit_cost decimal(10,2) NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('purchase', 'average')),
  source_id uuid,
  created_at timestamptz DEFAULT now(),
  hotel_id uuid REFERENCES hotels(id) NOT NULL
);

-- Add cost tracking to hotel_transfers
ALTER TABLE hotel_transfers
ADD COLUMN IF NOT EXISTS unit_cost decimal(10,2),
ADD COLUMN IF NOT EXISTS total_cost decimal(10,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED;

-- Add financial tracking to inventory_movements
ALTER TABLE inventory_movements
ADD COLUMN IF NOT EXISTS unit_cost decimal(10,2),
ADD COLUMN IF NOT EXISTS total_cost decimal(10,2) GENERATED ALWAYS AS (ABS(quantity_change) * unit_cost) STORED;

-- Create indexes
CREATE INDEX idx_hotel_balances_hotel ON hotel_balances(hotel_id);
CREATE INDEX idx_hotel_balances_type ON hotel_balances(transaction_type, created_at);
CREATE INDEX idx_purchase_payments_purchase ON purchase_payments(purchase_id);
CREATE INDEX idx_purchase_payments_hotel ON purchase_payments(hotel_id);
CREATE INDEX idx_product_costs_product ON product_costs(product_id);
CREATE INDEX idx_product_costs_date ON product_costs(cost_date DESC);

-- Enable RLS
ALTER TABLE hotel_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow authenticated read balances"
  ON hotel_balances FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated read payments"
  ON purchase_payments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated read costs"
  ON product_costs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow admin manage finances"
  ON hotel_balances FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND auth_users.role = 'admin'
    )
  );

CREATE POLICY "Allow admin manage payments"
  ON purchase_payments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND auth_users.role = 'admin'
    )
  );

CREATE POLICY "Allow admin manage costs"
  ON product_costs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND auth_users.role = 'admin'
    )
  );

-- Add comments
COMMENT ON TABLE hotel_balances IS 'Tracks financial balance for each hotel';
COMMENT ON TABLE purchase_payments IS 'Records how much each hotel paid for purchases';
COMMENT ON TABLE product_costs IS 'Tracks cost history for products';
COMMENT ON COLUMN hotel_transfers.unit_cost IS 'Cost per unit for transferred products';
COMMENT ON COLUMN hotel_transfers.total_cost IS 'Total cost of the transfer';
COMMENT ON COLUMN inventory_movements.unit_cost IS 'Cost per unit for the movement';
COMMENT ON COLUMN inventory_movements.total_cost IS 'Total cost of the movement';