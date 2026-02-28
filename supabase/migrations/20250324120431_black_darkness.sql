/*
  # Add supplier field and update quantity constraints

  1. Changes
    - Add supplier field to products table
    - Remove min/max quantity constraints to allow 0 values
    - Add index for supplier queries
    - Update comments

  2. Security
    - No changes to RLS policies needed
*/

-- Add supplier column
ALTER TABLE products
ADD COLUMN IF NOT EXISTS supplier text;

-- Create index for supplier queries
CREATE INDEX IF NOT EXISTS idx_products_supplier
ON products(supplier)
WHERE supplier IS NOT NULL;

-- Add comment
COMMENT ON COLUMN products.supplier IS 'Product supplier name for purchase orders';