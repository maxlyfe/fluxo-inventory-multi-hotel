/*
  # Add Product Quantity Management Columns

  1. Changes
    - Add quantity, min_quantity, and max_quantity columns to products table
    - Add indexes for better performance when querying stock levels
    
  2. Notes
    - These columns are needed for inventory management features
*/

-- Add quantity management columns to products
ALTER TABLE products
ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS min_quantity integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_quantity integer NOT NULL DEFAULT 100;

-- Add index for low stock queries
CREATE INDEX IF NOT EXISTS idx_products_stock_level
ON products(quantity)
WHERE quantity <= min_quantity;

-- Add index for category and stock level queries
CREATE INDEX IF NOT EXISTS idx_products_category_stock
ON products(category, quantity);

COMMENT ON COLUMN products.quantity IS 'Current stock quantity';
COMMENT ON COLUMN products.min_quantity IS 'Minimum stock level before reorder';
COMMENT ON COLUMN products.max_quantity IS 'Maximum stock capacity';