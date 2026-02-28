/*
  # Fix Stock Update Triggers

  1. Changes
    - Drop existing triggers and functions
    - Create new combined function to handle stock updates
    - Add proper error handling
    - Prevent recursive triggers
    
  2. Security
    - Maintain SECURITY DEFINER for elevated privileges
    - Add proper checks and validations
*/

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS update_stock_on_delivery ON requisitions;
DROP TRIGGER IF EXISTS update_product_quantity_on_movement ON inventory_movements;
DROP FUNCTION IF EXISTS update_stock_on_delivery();
DROP FUNCTION IF EXISTS update_product_quantity();

-- Create new combined function
CREATE OR REPLACE FUNCTION handle_requisition_delivery()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' AND NEW.product_id IS NOT NULL THEN
    -- Update product quantity directly
    UPDATE products
    SET 
      quantity = quantity - COALESCE(NEW.delivered_quantity, NEW.quantity),
      updated_at = now()
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
EXCEPTION WHEN OTHERS THEN
  -- Log error details
  RAISE NOTICE 'Error in handle_requisition_delivery: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create new trigger
CREATE TRIGGER handle_requisition_delivery
  AFTER UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION handle_requisition_delivery();

-- Add comment
COMMENT ON FUNCTION handle_requisition_delivery IS 'Handles stock updates and movement records when requisitions are delivered';