/*
  # Fix Requisitions Products Relation

  1. Changes
    - Add foreign key constraint between requisitions and products
    - Add index for product_id lookups
    - Add comments for documentation

  2. Security
    - No changes to RLS policies needed
*/

-- Add foreign key constraint
ALTER TABLE requisitions
ADD CONSTRAINT requisitions_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products(id);

-- Add index for product_id lookups
CREATE INDEX IF NOT EXISTS idx_requisitions_product_id
ON requisitions(product_id);

-- Add comments
COMMENT ON COLUMN requisitions.product_id IS 'Reference to products table, null for custom items';