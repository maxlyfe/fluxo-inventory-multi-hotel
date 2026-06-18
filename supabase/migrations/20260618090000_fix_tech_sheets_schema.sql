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

-- 2. Add category_id to dishes
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES dish_categories(id) ON DELETE SET NULL;

-- 3. Add is_active to sectors (Standard GEMINI.md)
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
UPDATE sectors SET is_active = true WHERE is_active IS NULL;

-- 4. Enable RLS and Policies
ALTER TABLE dish_categories ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dish_categories' 
    AND policyname = 'dish_categories_auth_all'
  ) THEN
    CREATE POLICY "dish_categories_auth_all" ON dish_categories 
      FOR ALL TO authenticated 
      USING (true) 
      WITH CHECK (true);
  END IF;
END $$;

-- 5. Add indexes
CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category_id);
CREATE INDEX IF NOT EXISTS idx_dish_categories_hotel ON dish_categories(hotel_id);
CREATE INDEX IF NOT EXISTS idx_sectors_active ON sectors(is_active) WHERE is_active = true;
