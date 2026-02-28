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

    -- If there's a substituted product, we'll update its stock instead of the original
    IF NEW.substituted_product_id IS NOT NULL THEN
      -- Get current stock of substituted product with lock
      SELECT quantity INTO v_current_stock
      FROM products
      WHERE id = NEW.substituted_product_id
      FOR UPDATE NOWAIT;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto substituto não encontrado';
      END IF;

      v_quantity := COALESCE(NEW.delivered_quantity, NEW.quantity);

      IF v_current_stock < v_quantity THEN
        RAISE EXCEPTION 'Quantidade insuficiente do produto substituto (disponível: %, necessário: %)', 
          v_current_stock, v_quantity;
      END IF;

      -- Update substituted product quantity
      UPDATE products
      SET 
        quantity = quantity - v_quantity,
        updated_at = now()
      WHERE id = NEW.substituted_product_id
      AND quantity >= v_quantity;  -- Extra check to prevent negative stock

      GET DIAGNOSTICS v_current_stock = ROW_COUNT;
      IF v_current_stock = 0 THEN
        RAISE EXCEPTION 'Falha ao atualizar estoque do produto substituto';
      END IF;

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
        -v_quantity,
        'saida',
        'Requisição entregue (substituição)',
        current_user,
        NEW.hotel_id
      );

    -- Handle original product if no substitution
    ELSIF NEW.product_id IS NOT NULL THEN
      -- Get current stock of original product with lock
      SELECT quantity INTO v_current_stock
      FROM products
      WHERE id = NEW.product_id
      FOR UPDATE NOWAIT;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado';
      END IF;

      v_quantity := COALESCE(NEW.delivered_quantity, NEW.quantity);

      IF v_current_stock < v_quantity THEN
        RAISE EXCEPTION 'Quantidade insuficiente em estoque (disponível: %, necessário: %)', 
          v_current_stock, v_quantity;
      END IF;

      -- Update original product quantity
      UPDATE products
      SET 
        quantity = quantity - v_quantity,
        updated_at = now()
      WHERE id = NEW.product_id
      AND quantity >= v_quantity;  -- Extra check to prevent negative stock

      GET DIAGNOSTICS v_current_stock = ROW_COUNT;
      IF v_current_stock = 0 THEN
        RAISE EXCEPTION 'Falha ao atualizar estoque do produto';
      END IF;

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
        -v_quantity,
        'saida',
        'Requisição entregue',
        current_user,
        NEW.hotel_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
EXCEPTION 
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'Produto está sendo atualizado por outra operação. Tente novamente.';
  WHEN OTHERS THEN
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