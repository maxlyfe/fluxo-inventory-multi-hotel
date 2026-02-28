/*
  # Add Product Creation/Update Trigger

  1. Changes
    - Add trigger to handle product quantity changes
    - Create initial inventory movement on product creation
    - Update inventory movement on product quantity changes
    
  2. Security
    - No changes to RLS policies needed
*/

-- Create function to handle product changes
CREATE OR REPLACE FUNCTION handle_product_quantity_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if quantity has changed
  IF (TG_OP = 'INSERT') OR 
     (TG_OP = 'UPDATE' AND OLD.quantity != NEW.quantity) THEN
    
    -- Calculate the change in quantity
    DECLARE
      quantity_change integer;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        quantity_change := NEW.quantity;
      ELSE
        quantity_change := NEW.quantity - OLD.quantity;
      END IF;

      -- Create inventory movement record
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        movement_type,
        reason,
        performed_by
      ) VALUES (
        NEW.id,
        quantity_change,
        CASE 
          WHEN quantity_change > 0 THEN 'entrada'
          ELSE 'ajuste'
        END,
        CASE 
          WHEN TG_OP = 'INSERT' THEN 'Cadastro inicial do produto'
          ELSE 'Ajuste manual de quantidade'
        END,
        current_user
      );
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for product changes
CREATE TRIGGER handle_product_quantity_change
  AFTER INSERT OR UPDATE OF quantity ON products
  FOR EACH ROW
  EXECUTE FUNCTION handle_product_quantity_change();

-- Add comment
COMMENT ON FUNCTION handle_product_quantity_change IS 'Creates inventory movements when products are created or quantities are updated';