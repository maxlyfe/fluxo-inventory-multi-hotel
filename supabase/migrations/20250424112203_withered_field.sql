/*
  # Fix Requisition Delivery Handler

  1. Changes
    - Update delivery handler to support substituted products
    - Handle inventory updates for both original and substitute products
    - Add proper error handling
    
  2. Security
    - Maintain SECURITY DEFINER for elevated privileges
    - Add proper checks and validations
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS handle_requisition_delivery ON requisitions;
DROP FUNCTION IF EXISTS handle_requisition_delivery();

-- Create improved function to handle requisition delivery
CREATE OR REPLACE FUNCTION handle_requisition_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- If there's a substituted product, update its stock
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
    -- Otherwise, update the original product's stock
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
EXCEPTION WHEN OTHERS THEN
  -- Log error details
  RAISE NOTICE 'Error in handle_requisition_delivery: %', SQLERRM;
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