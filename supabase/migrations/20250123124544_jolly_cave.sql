/*
  # Initial Schema Setup for Hotel Requisition System

  1. New Tables
    - `sectors` - Hotel departments/sectors
      - `id` (uuid, primary key)
      - `name` (text) - Sector name
      - `created_at` (timestamp)
    
    - `requisitions` - Item requisitions from sectors
      - `id` (uuid, primary key)
      - `sector_id` (uuid, foreign key)
      - `item_name` (text)
      - `quantity` (integer)
      - `status` (text) - 'pending' or 'delivered'
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `inventory` - Stock items
      - `id` (uuid, primary key)
      - `item_name` (text)
      - `quantity` (integer)
      - `last_updated` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Public read access for sectors and inventory
    - Authenticated admin access for managing inventory
    - Public access for creating requisitions
*/

-- Create sectors table
CREATE TABLE sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create requisitions table
CREATE TABLE requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid REFERENCES sectors(id),
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create inventory table
CREATE TABLE inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  last_updated timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow public read sectors" ON sectors
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public read inventory" ON inventory
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow admin manage inventory" ON inventory
  FOR ALL TO authenticated
  USING (auth.email() = 'admin');

CREATE POLICY "Allow public create requisitions" ON requisitions
  FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Allow public read requisitions" ON requisitions
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow public update own sector requisitions" ON requisitions
  FOR UPDATE TO public
  USING (true)
  WITH CHECK (status = 'pending');

-- Insert default sectors
INSERT INTO sectors (name) VALUES
  ('Recepção'),
  ('Restaurante'),
  ('Cozinha'),
  ('Produção'),
  ('Governança'),
  ('Manutenção'),
  ('Reservas'),
  ('Gerência'),
  ('RH');