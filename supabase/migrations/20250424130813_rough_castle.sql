-- Drop existing trigger and function
DROP TRIGGER IF EXISTS handle_requisition_delivery ON requisitions;
DROP FUNCTION IF EXISTS handle_requisition_delivery();

-- Create improved function to handle requisition delivery
CREATE OR REPLACE FUNCTION handle_requisition_delivery()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id uuid;
  v_quantity integer;
  v_current_stock integer;
BEGIN
  -- Only proceed if this is a delivery (status changing from pending to delivered)
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    -- For custom items (is_custom = true), no stock updates needed
    IF NEW.is_custom THEN
      RETURN NEW;
    END IF;

    -- Determine which product to update and the quantity
    v_product_id := COALESCE(NEW.substituted_product_id, NEW.product_id);
    v_quantity := COALESCE(NEW.delivered_quantity, NEW.quantity);

    IF v_product_id IS NOT NULL THEN
      -- Get current stock with lock
      SELECT quantity INTO v_current_stock
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado';
      END IF;

      IF v_current_stock < v_quantity THEN
        RAISE EXCEPTION 'Quantidade insuficiente em estoque (disponível: %, necessário: %)', 
          v_current_stock, v_quantity;
      END IF;

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
EXCEPTION WHEN OTHERS THEN
  -- Log error details with more context
  RAISE NOTICE 'Error in handle_requisition_delivery for requisition %: %', NEW.id, SQLERRM;
  RAISE;  -- Re-raise the exception to ensure the transaction is rolled back
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for automatic stock updates on delivery
CREATE TRIGGER handle_requisition_delivery
  BEFORE UPDATE ON requisitions
  FOR EACH ROW
  EXECUTE FUNCTION handle_requisition_delivery();

-- Add comment for documentation
COMMENT ON FUNCTION handle_requisition_delivery() IS 'Handles stock updates and movement records when requisitions are delivered, including substituted products and custom items';