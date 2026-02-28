/*
  # Add product_id column to requisitions table

  1. Changes
    - Add product_id column to requisitions table
    - Add is_custom column to track custom items
    - Add indexes for better performance

  2. Notes
    - product_id is nullable since we support custom items
    - is_custom helps distinguish between catalog and custom items
*/

-- Add columns to requisitions table
ALTER TABLE requisitions
ADD COLUMN IF NOT EXISTS product_id uuid,
ADD COLUMN IF NOT EXISTS is_custom boolean DEFAULT false;

-- Add index for product_id
CREATE INDEX IF NOT EXISTS idx_requisitions_product_id
ON requisitions(product_id);

-- Add index for custom items
CREATE INDEX IF NOT EXISTS idx_requisitions_custom
ON requisitions(is_custom)
WHERE is_custom = true;

-- Add comments
COMMENT ON COLUMN requisitions.product_id IS 'Reference to products table, null for custom items';
COMMENT ON COLUMN requisitions.is_custom IS 'Indicates if this is a custom item not in the products catalog';