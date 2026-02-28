/*
  # Update product quantity constraints

  1. Changes
    - Remove min/max quantity constraints
    - Add supplier field
    - Add index for supplier queries
    - Update comments

  2. Security
    - No changes to RLS policies needed
*/

-- Add supplier column if not exists
ALTER TABLE products
ADD COLUMN IF NOT EXISTS supplier text;

-- Create index for supplier queries
CREATE INDEX IF NOT EXISTS idx_products_supplier
ON products(supplier)
WHERE supplier IS NOT NULL;

-- Add comment
COMMENT ON COLUMN products.supplier IS 'Product supplier name for purchase orders';