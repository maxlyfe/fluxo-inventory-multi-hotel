-- Fix technical sheets schema and missing columns
-- Date: 18/06/2026

-- 1. Create dish_categories table if it doesn't exist
CREATE TABLE IF NOT EXISTS dish_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Create ingredients table if it doesn't exist
CREATE TABLE IF NOT EXISTS ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'g',
  price_per_unit numeric DEFAULT 0,
  purchase_qty_per_unit numeric DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- 3. Create sides table if it doesn't exist
CREATE TABLE IF NOT EXISTS sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. Create dishes table if it doesn't exist
CREATE TABLE IF NOT EXISTS dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid REFERENCES hotels(id) ON DELETE CASCADE,
  production_sector_id uuid REFERENCES sectors(id) ON DELETE SET NULL,
  category_id uuid REFERENCES dish_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'dish' CHECK (type IN ('dish', 'drink')),
  created_at timestamptz DEFAULT now()
);

-- 5. Create dish_ingredients table if it doesn't exist
CREATE TABLE IF NOT EXISTS dish_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id uuid REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity numeric NOT NULL,
  unit text,
  created_at timestamptz DEFAULT now()
);

-- 6. Create dish_sides table if it doesn't exist
CREATE TABLE IF NOT EXISTS dish_sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id uuid REFERENCES dishes(id) ON DELETE CASCADE,
  side_id uuid REFERENCES sides(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- 7. Create side_ingredients table if it doesn't exist
CREATE TABLE IF NOT EXISTS side_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  side_id uuid REFERENCES sides(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity numeric NOT NULL,
  unit text,
  created_at timestamptz DEFAULT now()
);

-- 8. Add is_active to sectors (Standard GEMINI.md)
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
UPDATE sectors SET is_active = true WHERE is_active IS NULL;

-- 9. Ensure columns exist if tables already existed
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'dish' CHECK (type IN ('dish', 'drink'));
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES dish_categories(id) ON DELETE SET NULL;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS production_sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL;

-- 10. Enable RLS and Policies
ALTER TABLE dish_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sides ENABLE ROW LEVEL SECURITY;
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_sides ENABLE ROW LEVEL SECURITY;
ALTER TABLE side_ingredients ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  -- Simple policy for authenticated users (common in this project)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dish_categories' AND policyname = 'dish_categories_auth_all') THEN
    CREATE POLICY "dish_categories_auth_all" ON dish_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ingredients' AND policyname = 'ingredients_auth_all') THEN
    CREATE POLICY "ingredients_auth_all" ON ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sides' AND policyname = 'sides_auth_all') THEN
    CREATE POLICY "sides_auth_all" ON sides FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dishes' AND policyname = 'dishes_auth_all') THEN
    CREATE POLICY "dishes_auth_all" ON dishes FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dish_ingredients' AND policyname = 'dish_ingredients_auth_all') THEN
    CREATE POLICY "dish_ingredients_auth_all" ON dish_ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dish_sides' AND policyname = 'dish_sides_auth_all') THEN
    CREATE POLICY "dish_sides_auth_all" ON dish_sides FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'side_ingredients' AND policyname = 'side_ingredients_auth_all') THEN
    CREATE POLICY "side_ingredients_auth_all" ON side_ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 11. Add indexes
CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);
CREATE INDEX IF NOT EXISTS idx_dishes_hotel ON dishes(hotel_id);
CREATE INDEX IF NOT EXISTS idx_dishes_type ON dishes(type);
CREATE INDEX IF NOT EXISTS idx_dish_categories_hotel ON dish_categories(hotel_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_hotel ON ingredients(hotel_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_product ON ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_sides_hotel ON sides(hotel_id);
CREATE INDEX IF NOT EXISTS idx_sectors_active ON sectors(is_active) WHERE is_active = true;
