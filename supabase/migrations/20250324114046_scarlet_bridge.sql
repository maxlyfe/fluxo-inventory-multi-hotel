/*
  # Fix Product Deletion Constraints

  1. Changes
    - Add ON DELETE RESTRICT to inventory_movements foreign key
    - Add function to safely delete products
    - Add policy to allow deletion only when no movements exist

  2. Security
    - Maintains data integrity by preventing deletion of products with movements
    - Provides clear error message when deletion is not possible
*/

-- Drop existing foreign key constraint
ALTER TABLE inventory_movements
DROP CONSTRAINT IF EXISTS inventory_movements_product_id_fkey;

-- Recreate with RESTRICT
ALTER TABLE inventory_movements
ADD CONSTRAINT inventory_movements_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products(id)
ON DELETE RESTRICT;

-- Create function to safely delete products
CREATE OR REPLACE FUNCTION safe_delete_product(p_product_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movements_count integer;
BEGIN
  -- Check for existing movements
  SELECT COUNT(*)
  INTO v_movements_count
  FROM inventory_movements
  WHERE product_id = p_product_id;

  -- If movements exist, return error
  IF v_movements_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Não é possível excluir o produto pois existem movimentações de estoque associadas.'
    );
  END IF;

  -- Delete the product if no movements exist
  DELETE FROM products
  WHERE id = p_product_id;

  RETURN json_build_object(
    'success', true,
    'message', 'Produto excluído com sucesso.'
  );
END;
$$;