-- Function to handle hotel transfers
CREATE OR REPLACE FUNCTION handle_hotel_transfer()
RETURNS TRIGGER AS $$
DECLARE
  v_source_quantity integer;
  v_destination_product_id uuid;
  v_source_product_name text;
BEGIN
  -- Only handle completion of pending transfers
  IF NEW.status = 'completed' AND OLD.status = 'pending' THEN
    -- Get source product name and check quantity
    SELECT name, quantity INTO v_source_product_name, v_source_quantity
    FROM products
    WHERE id = NEW.product_id AND hotel_id = NEW.source_hotel_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado no hotel de origem';
    END IF;

    IF v_source_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Quantidade insuficiente no hotel de origem (disponível: %, necessário: %)', 
        v_source_quantity, NEW.quantity;
    END IF;

    -- Check if product exists in destination hotel
    SELECT id INTO v_destination_product_id
    FROM products
    WHERE name = v_source_product_name
    AND hotel_id = NEW.destination_hotel_id;

    -- Begin transaction to ensure atomicity
    BEGIN
      -- Decrease quantity from source hotel
      UPDATE products
      SET 
        quantity = quantity - NEW.quantity,
        updated_at = now()
      WHERE id = NEW.product_id AND hotel_id = NEW.source_hotel_id;

      IF v_destination_product_id IS NULL THEN
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
          now(),
          now()
        FROM products
        WHERE id = NEW.product_id
        RETURNING id INTO v_destination_product_id;
      ELSE
        -- Update existing product quantity
        UPDATE products
        SET 
          quantity = quantity + NEW.quantity,
          updated_at = now()
        WHERE id = v_destination_product_id;
      END IF;

      -- Create movement records
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        movement_type,
        reason,
        performed_by,
        hotel_id
      ) VALUES
      -- Source hotel movement
      (
        NEW.product_id,
        -NEW.quantity,
        'saida',
        'Transferência entre hotéis - Saída',
        current_user,
        NEW.source_hotel_id
      ),
      -- Destination hotel movement
      (
        COALESCE(v_destination_product_id, NEW.product_id),
        NEW.quantity,
        'entrada',
        'Transferência entre hotéis - Entrada',
        current_user,
        NEW.destination_hotel_id
      );

      -- Update completed_at timestamp
      NEW.completed_at = now();
    EXCEPTION WHEN OTHERS THEN
      -- Rollback will happen automatically
      RAISE EXCEPTION 'Erro ao processar transferência: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS handle_hotel_transfer ON hotel_transfers;

-- Create trigger for transfers
CREATE TRIGGER handle_hotel_transfer
  BEFORE UPDATE ON hotel_transfers
  FOR EACH ROW
  EXECUTE FUNCTION handle_hotel_transfer();

-- Add comments
COMMENT ON FUNCTION handle_hotel_transfer() IS 'Handles product transfers between hotels, including creating products if needed';