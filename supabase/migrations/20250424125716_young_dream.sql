-- Drop existing trigger and function
DROP TRIGGER IF EXISTS handle_requisition_delivery ON requisitions;
DROP FUNCTION IF EXISTS handle_requisition_delivery();

-- Create improved function to handle requisition delivery
CREATE OR REPLACE FUNCTION handle_requisition_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- For custom items (is_custom = true), no stock updates needed
    IF NEW.is_custom THEN
      RETURN NEW;
    END IF;

    -- Handle substituted product
    IF NEW.substituted_product_id IS NOT NULL THEN
      -- Update substituted product quantity
      UPDATE products
      SET 
        quantity = quantity - COALESCE(NEW.delivered_quantity, NEW.quantity),
        updated_at = now()
      WHERE id = NEW.substituted_product_id;

      -- Create movement record for substituted product
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        movement_type,
        reason,
        performed_by,
        hotel_id
      ) VALUES (
        NEW.substituted_product_id,
        -COALESCE(NEW.delivered_quantity, NEW.quantity),
        'saida',
        'Requisição entregue (substituição)',
        current_user,
        NEW.hotel_id
      );
    -- Handle original product
    ELSIF NEW.product_id IS NOT NULL THEN
      -- Update original product quantity
      UPDATE products
      SET 
        quantity = quantity - COALESCE(NEW.delivered_quantity, NEW.quantity),
        updated_at = now()
      WHERE id = NEW.product_id;

      -- Create movement record for original product
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        movement_type,
        reason,
        performed_by,
        hotel_id
      ) VALUES (
        NEW.product_id,
        -COALESCE(NEW.delivered_quantity, NEW.quantity),
        'saida',
        'Requisição entregue',
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
COMMENT ON FUNCTION handle_requisition_delivery() IS 'Handles stock updates and movement records when requisitions are delivered, including substituted products and custom items';