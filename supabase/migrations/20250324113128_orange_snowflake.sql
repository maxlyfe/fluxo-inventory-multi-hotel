/*
  # Update Inventory Update Trigger

  1. Changes
    - Drop existing trigger and function
    - Recreate function with improved logic
    - Recreate trigger
    
  2. Security
    - Function runs with SECURITY DEFINER to ensure it has necessary permissions
    - Creates inventory movements to track stock changes
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_stock_on_delivery ON requisitions;
DROP FUNCTION IF EXISTS update_stock_on_delivery();

-- Create improved function to update product stock when requisition is delivered
CREATE OR REPLACE FUNCTION update_stock_on_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' AND NEW.product_id IS NOT NULL THEN
    -- Update product stock
    UPDATE products
    SET quantity = quantity - COALESCE(NEW.delivered_quantity, NEW.quantity)
    WHERE id = NEW.product_id;

    -- Create movement record
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by
    ) VALUES (
      NEW.product_id,
      -COALESCE(NEW.delivered_quantity, NEW.quantity),
      'saida',
      'Requisição entregue',
      current_user
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for automatic stock updates on delivery
CREATE TRIGGER update_stock_on_delivery
  AFTER UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_on_delivery();

-- Add comment for documentation
COMMENT ON FUNCTION update_stock_on_delivery() IS 'Automatically updates product stock and creates inventory movement when requisition is delivered';