/*
  # Fix Purchase Trigger and Stock Updates

  1. Changes
    - Drop and recreate update_product_prices function with improved logic
    - Add proper stock quantity updates
    - Add transaction control for atomicity
    - Add better error handling
    
  2. Security
    - Maintain SECURITY DEFINER for elevated privileges
    - Add proper checks and validations
*/

-- Drop existing function and trigger
DROP TRIGGER IF EXISTS update_product_prices_after_purchase ON purchase_items;
DROP FUNCTION IF EXISTS update_product_prices();

-- Create improved function to handle purchase items
CREATE OR REPLACE FUNCTION update_product_prices()
RETURNS TRIGGER AS $$
DECLARE
  v_hotel_id uuid;
  v_invoice_number text;
BEGIN
  -- Get purchase details
  SELECT hotel_id, invoice_number INTO v_hotel_id, v_invoice_number
  FROM purchases
  WHERE id = NEW.purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra não encontrada';
  END IF;

  -- Begin transaction
  BEGIN
    -- Update product stock and price information
    UPDATE products
    SET 
      quantity = quantity + NEW.quantity,
      last_purchase_date = NEW.created_at,
      last_purchase_price = NEW.unit_price,
      average_price = (
        SELECT ROUND(
          (COALESCE(SUM(unit_price * quantity), 0) + (NEW.unit_price * NEW.quantity)) / 
          (COALESCE(SUM(quantity), 0) + NEW.quantity)
        ::numeric, 2)
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE pi.product_id = NEW.product_id
        AND p.hotel_id = v_hotel_id
        AND pi.id != NEW.id
      ),
      updated_at = now()
    WHERE id = NEW.product_id
    AND hotel_id = v_hotel_id;

    -- Create inventory movement record
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      movement_type,
      reason,
      performed_by,
      hotel_id
    ) VALUES (
      NEW.product_id,
      NEW.quantity,
      'entrada',
      'Compra - NF: ' || v_invoice_number,
      current_user,
      v_hotel_id
    );

  EXCEPTION WHEN OTHERS THEN
    -- Rollback will happen automatically
    RAISE EXCEPTION 'Erro ao processar item da compra: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for purchase items
CREATE TRIGGER update_product_prices_after_purchase
  AFTER INSERT ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION update_product_prices();

-- Add comments
COMMENT ON FUNCTION update_product_prices IS 'Updates product stock, prices and creates inventory movements when purchases are made';