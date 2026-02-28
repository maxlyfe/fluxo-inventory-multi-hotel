-- Drop existing trigger and function
DROP TRIGGER IF EXISTS handle_hotel_transfer ON hotel_transfers;
DROP FUNCTION IF EXISTS handle_hotel_transfer();

-- Create improved function to handle hotel transfers
CREATE OR REPLACE FUNCTION handle_hotel_transfer()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id uuid;
  v_quantity integer;
  v_current_stock integer;
  v_unit_cost decimal(10,2);
  v_total_cost decimal(10,2);
BEGIN
  -- Only proceed if this is a completion of pending transfer
  IF NEW.status = 'completed' AND OLD.status = 'pending' THEN
    -- Get current stock of source product with lock
    SELECT quantity, COALESCE(average_price, last_purchase_price, 0)
    INTO v_current_stock, v_unit_cost
    FROM products
    WHERE id = NEW.product_id
    AND hotel_id = NEW.source_hotel_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado no hotel de origem';
    END IF;

    IF v_current_stock < NEW.quantity THEN
      RAISE EXCEPTION 'Quantidade insuficiente em estoque (disponível: %, necessário: %)', 
        v_current_stock, NEW.quantity;
    END IF;

    -- Calculate total cost
    v_total_cost := NEW.quantity * v_unit_cost;

    -- Update source product quantity
    UPDATE products
    SET 
      quantity = quantity - NEW.quantity,
      updated_at = now()
    WHERE id = NEW.product_id
    AND hotel_id = NEW.source_hotel_id
    AND quantity >= NEW.quantity;

    -- Create movement record for source
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by,
      hotel_id,
      unit_cost
    ) VALUES (
      NEW.product_id,
      -NEW.quantity,
      'saida',
      'Transferência entre hotéis (saída)',
      current_user,
      NEW.source_hotel_id,
      v_unit_cost
    );

    -- Check if product exists in destination hotel
    SELECT id INTO v_product_id
    FROM products
    WHERE name = (SELECT name FROM products WHERE id = NEW.product_id)
    AND hotel_id = NEW.destination_hotel_id;

    IF v_product_id IS NULL THEN
      -- Create product in destination hotel
      INSERT INTO products (
        name,
        category,
        quantity,
        min_quantity,
        max_quantity,
        supplier,
        image_url,
        description,
        hotel_id,
        last_purchase_price,
        average_price,
        created_at,
        updated_at
      )
      SELECT
        name,
        category,
        NEW.quantity,
        min_quantity,
        max_quantity,
        supplier,
        image_url,
        description,
        NEW.destination_hotel_id,
        v_unit_cost,
        v_unit_cost,
        now(),
        now()
      FROM products
      WHERE id = NEW.product_id
      RETURNING id INTO v_product_id;
    ELSE
      -- Update existing product quantity and cost
      UPDATE products
      SET 
        quantity = quantity + NEW.quantity,
        last_purchase_price = v_unit_cost,
        average_price = (
          COALESCE(average_price, 0) * COALESCE(quantity, 0) + v_total_cost
        ) / (COALESCE(quantity, 0) + NEW.quantity),
        updated_at = now()
      WHERE id = v_product_id;
    END IF;

    -- Create movement record for destination
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by,
      hotel_id,
      unit_cost
    ) VALUES (
      v_product_id,
      NEW.quantity,
      'entrada',
      'Transferência entre hotéis (entrada)',
      current_user,
      NEW.destination_hotel_id,
      v_unit_cost
    );

    -- Update transfer with cost information
    NEW.unit_cost = v_unit_cost;
    NEW.completed_at = now();

    -- Record financial transaction
    PERFORM record_transfer_cost(NEW.id, v_unit_cost);
  END IF;
  
  RETURN NEW;
EXCEPTION 
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'Produto está sendo atualizado por outra operação. Tente novamente.';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in handle_hotel_transfer for transfer %: %', NEW.id, SQLERRM;
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for transfers
CREATE TRIGGER handle_hotel_transfer
  BEFORE UPDATE ON hotel_transfers
  FOR EACH ROW
  EXECUTE FUNCTION handle_hotel_transfer();

-- Add comment for documentation
COMMENT ON FUNCTION handle_hotel_transfer() IS 'Handles product transfers between hotels, including cost tracking and financial transactions';