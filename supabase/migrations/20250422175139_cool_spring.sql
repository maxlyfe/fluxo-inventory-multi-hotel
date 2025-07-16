/*
  # Add Active Status and Substitutions

  1. Changes
    - Add active column to products table
    - Add substitution_id column to requisitions table
    - Add indexes for better performance
    - Update comments and constraints

  2. Security
    - No changes to RLS policies needed
*/

-- Add active status to products
ALTER TABLE products
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Add substitution tracking to requisitions
ALTER TABLE requisitions
ADD COLUMN IF NOT EXISTS substituted_product_id uuid REFERENCES products(id),
ADD COLUMN IF NOT EXISTS substitution_reason text;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_active
ON products(is_active)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_requisitions_substitution
ON requisitions(substituted_product_id)
WHERE substituted_product_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN products.is_active IS 'Indicates if the product is active and available for requisitions';
COMMENT ON COLUMN requisitions.substituted_product_id IS 'Reference to the product that was delivered instead of the original';
COMMENT ON COLUMN requisitions.substitution_reason IS 'Reason for delivering a different product than requested';