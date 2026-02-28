-- Drop existing trigger and function
DROP TRIGGER IF EXISTS handle_requisition_delivery ON requisitions;
DROP FUNCTION IF EXISTS handle_requisition_delivery();

-- Create simplified function to handle requisition delivery
CREATE OR REPLACE FUNCTION handle_requisition_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id uuid;
  v_quantity integer;
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- Determine which product to update (substituted or original)
    v_product_id := COALESCE(NEW.substituted_product_id, NEW.product_id);
    v_quantity := COALESCE(NEW.delivered_quantity, NEW.quantity);

    -- If we have a product to update (either substituted or original)
    IF v_product_id IS NOT NULL THEN
      -- Update product quantity
      UPDATE products
      SET 
        quantity = quantity - v_quantity,
        updated_at = now()
      WHERE id = v_product_id;

      -- Create movement record
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        movement_type,
        reason,
        performed_by,
        hotel_id
      ) VALUES (
        v_product_id,
        -v_quantity,
        'saida',
        CASE 
          WHEN NEW.substituted_product_id IS NOT NULL THEN 'Requisição entregue (substituição)'
          ELSE 'Requisição entregue'
        END,
        current_user,
        NEW.hotel_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for automatic stock updates on delivery
CREATE TRIGGER handle_requisition_delivery
  AFTER UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION handle_requisition_delivery();

-- Add comment for documentation
COMMENT ON FUNCTION handle_requisition_delivery() IS 'Handles stock updates and movement records when requisitions are delivered, including substituted products';