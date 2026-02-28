/*
  # Update product quantity constraints and add trigger for shopping list

  1. Changes
    - Add trigger to update products table on inventory movements
    - Add function to handle quantity updates
    - Add supplier field and indexes
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

-- Create or replace function to update product quantities
CREATE OR REPLACE FUNCTION update_product_quantity()
RETURNS TRIGGER AS $$
BEGIN
  -- Update product quantity based on movement type
  UPDATE products
  SET 
    quantity = CASE 
      WHEN NEW.movement_type = 'entrada' THEN quantity + NEW.quantity_change
      WHEN NEW.movement_type = 'saida' THEN quantity - ABS(NEW.quantity_change)
      ELSE quantity + NEW.quantity_change -- For adjustments
    END,
    updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for inventory movements
CREATE TRIGGER update_product_quantity_on_movement
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION update_product_quantity();

-- Add comment
COMMENT ON COLUMN products.supplier IS 'Product supplier name for purchase orders';
COMMENT ON FUNCTION update_product_quantity IS 'Updates product quantity when inventory movements occur';