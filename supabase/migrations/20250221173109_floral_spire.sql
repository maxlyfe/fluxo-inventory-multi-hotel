-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_stock_on_delivery ON requisitions;
DROP FUNCTION IF EXISTS update_stock_on_delivery();

-- Create improved function to update product stock when a requisition is delivered
CREATE OR REPLACE FUNCTION update_stock_on_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' AND NEW.product_id IS NOT NULL THEN
    -- Create movement record
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by
    ) VALUES (
      NEW.product_id,
      COALESCE(NEW.delivered_quantity, NEW.quantity),
      'saida',
      'Requisição entregue',
      current_user
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic stock updates on delivery
CREATE TRIGGER update_stock_on_delivery
  AFTER UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_on_delivery();

-- Add comment for documentation
COMMENT ON FUNCTION update_stock_on_delivery() IS 'Automatically creates inventory movement when requisition is delivered';