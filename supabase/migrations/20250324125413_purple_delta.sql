/*
  # Multi-Hotel System Setup

  1. New Tables
    - `hotels`
      - `id` (uuid, primary key)
      - `code` (text, unique)
      - `name` (text)
      - `address` (text)
      - `created_at` (timestamp)

    - `hotel_transfers`
      - `id` (uuid, primary key)
      - `source_hotel_id` (uuid, references hotels)
      - `destination_hotel_id` (uuid, references hotels)
      - `product_id` (uuid, references products)
      - `quantity` (integer)
      - `status` (text) - 'pending', 'completed', 'cancelled'
      - `notes` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
      - `completed_at` (timestamp)

  2. Changes to Existing Tables
    - Add `hotel_id` to:
      - sectors
      - products
      - requisitions
      - inventory_movements
      - governance_stock
      - auth_users (for default hotel)

  3. Security
    - Enable RLS on new tables
    - Update existing policies to consider hotel_id
*/

-- Create hotels table
CREATE TABLE hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  address text,
  created_at timestamptz DEFAULT now()
);

-- Create hotel_transfers table
CREATE TABLE hotel_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hotel_id uuid REFERENCES hotels(id),
  destination_hotel_id uuid REFERENCES hotels(id),
  product_id uuid REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT different_hotels CHECK (source_hotel_id != destination_hotel_id)
);

-- Add hotel_id to existing tables
ALTER TABLE sectors ADD COLUMN hotel_id uuid REFERENCES hotels(id);
ALTER TABLE products ADD COLUMN hotel_id uuid REFERENCES hotels(id);
ALTER TABLE requisitions ADD COLUMN hotel_id uuid REFERENCES hotels(id);
ALTER TABLE inventory_movements ADD COLUMN hotel_id uuid REFERENCES hotels(id);
ALTER TABLE governance_stock ADD COLUMN hotel_id uuid REFERENCES hotels(id);
ALTER TABLE auth_users ADD COLUMN default_hotel_id uuid REFERENCES hotels(id);

-- Create indexes
CREATE INDEX idx_sectors_hotel ON sectors(hotel_id);
CREATE INDEX idx_products_hotel ON products(hotel_id);
CREATE INDEX idx_requisitions_hotel ON requisitions(hotel_id);
CREATE INDEX idx_inventory_movements_hotel ON inventory_movements(hotel_id);
CREATE INDEX idx_governance_stock_hotel ON governance_stock(hotel_id);
CREATE INDEX idx_hotel_transfers_source ON hotel_transfers(source_hotel_id);
CREATE INDEX idx_hotel_transfers_destination ON hotel_transfers(destination_hotel_id);
CREATE INDEX idx_hotel_transfers_status ON hotel_transfers(status);

-- Enable RLS
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_transfers ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow public read hotels"
  ON hotels FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated read transfers"
  ON hotel_transfers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow inventory manage transfers"
  ON hotel_transfers
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth_users
      WHERE auth_users.id = auth.uid()
      AND (auth_users.role = 'admin' OR auth_users.role = 'inventory')
    )
  );

-- Function to handle hotel transfers
CREATE OR REPLACE FUNCTION handle_hotel_transfer()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'pending' THEN
    -- Decrease quantity from source hotel
    INSERT INTO inventory_movements (
      hotel_id,
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by
    ) VALUES (
      NEW.source_hotel_id,
      NEW.product_id,
      -NEW.quantity,
      'saida',
      'Transferência entre hotéis',
      current_user
    );

    -- Increase quantity in destination hotel
    INSERT INTO inventory_movements (
      hotel_id,
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by
    ) VALUES (
      NEW.destination_hotel_id,
      NEW.product_id,
      NEW.quantity,
      'entrada',
      'Transferência entre hotéis',
      current_user
    );

    -- Update completed_at
    NEW.completed_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for transfers
CREATE TRIGGER handle_hotel_transfer
  BEFORE UPDATE ON hotel_transfers
  FOR EACH ROW
  EXECUTE FUNCTION handle_hotel_transfer();

-- Insert hotels
INSERT INTO hotels (id, code, name, address) VALUES
  ('11111111-1111-1111-1111-111111111111', 'CSB', 'Costa do Sol Boutique Hotel', 'Rua da Praia, 123 - Centro'),
  ('22222222-2222-2222-2222-222222222222', 'BRC', 'Brava Club', 'Av. Beira Mar, 456 - Praia Brava'),
  ('33333333-3333-3333-3333-333333333333', 'MRM', 'Maria Maria', 'Rua das Flores, 789 - Jardins'),
  ('44444444-4444-4444-4444-444444444444', 'VLP', 'Villa Pitanga', 'Estrada da Serra, 321 - Montanha');

-- Update existing records with default hotel (Costa do Sol)
UPDATE sectors SET hotel_id = '11111111-1111-1111-1111-111111111111';
UPDATE products SET hotel_id = '11111111-1111-1111-1111-111111111111';
UPDATE requisitions SET hotel_id = '11111111-1111-1111-1111-111111111111';
UPDATE inventory_movements SET hotel_id = '11111111-1111-1111-1111-111111111111';
UPDATE governance_stock SET hotel_id = '11111111-1111-1111-1111-111111111111';

-- Make hotel_id NOT NULL after setting defaults
ALTER TABLE sectors ALTER COLUMN hotel_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN hotel_id SET NOT NULL;
ALTER TABLE requisitions ALTER COLUMN hotel_id SET NOT NULL;
ALTER TABLE inventory_movements ALTER COLUMN hotel_id SET NOT NULL;
ALTER TABLE governance_stock ALTER COLUMN hotel_id SET NOT NULL;

-- Add comments
COMMENT ON TABLE hotels IS 'Hotels in the Meridiana group';
COMMENT ON TABLE hotel_transfers IS 'Records of product transfers between hotels';
COMMENT ON COLUMN hotels.code IS 'Unique identifier code for the hotel';
COMMENT ON COLUMN hotel_transfers.status IS 'Status of the transfer: pending, completed, or cancelled';
COMMENT ON COLUMN hotel_transfers.notes IS 'Additional notes about the transfer';