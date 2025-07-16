/*
  # Fix Product Deletion for Admins

  1. Changes
    - Drop existing foreign key constraints
    - Add new foreign key constraints with CASCADE for admin cleanup
    - Update safe_delete_product function to handle all dependencies
    - Add function to check if user is admin

  2. Security
    - Only admins can force delete products with movements
    - Regular inventory users still restricted by safe delete
*/

-- Drop existing foreign keys
ALTER TABLE inventory_movements
DROP CONSTRAINT IF EXISTS inventory_movements_product_id_fkey;

ALTER TABLE requisitions
DROP CONSTRAINT IF EXISTS requisitions_product_id_fkey;

ALTER TABLE governance_stock
DROP CONSTRAINT IF EXISTS governance_stock_product_id_fkey;

-- Recreate with CASCADE for admin cleanup
ALTER TABLE inventory_movements
ADD CONSTRAINT inventory_movements_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products(id)
ON DELETE CASCADE;

ALTER TABLE requisitions
ADD CONSTRAINT requisitions_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products(id)
ON DELETE SET NULL;

ALTER TABLE governance_stock
ADD CONSTRAINT governance_stock_product_id_fkey
FOREIGN KEY (product_id) REFERENCES products(id)
ON DELETE CASCADE;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth_users
    WHERE auth_users.id = auth.uid()
    AND auth_users.role = 'admin'
  );
END;
$$;

-- Update safe delete function to handle admin force delete
CREATE OR REPLACE FUNCTION safe_delete_product(p_product_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movements_count integer;
  v_is_admin boolean;
BEGIN
  -- Check if user is admin
  v_is_admin := is_admin();

  -- Check for existing movements
  SELECT COUNT(*)
  INTO v_movements_count
  FROM inventory_movements
  WHERE product_id = p_product_id;

  -- If movements exist and user is not admin, return error
  IF v_movements_count > 0 AND NOT v_is_admin THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Não é possível excluir o produto pois existem movimentações de estoque associadas. Apenas administradores podem forçar a exclusão.'
    );
  END IF;

  -- Delete the product (will cascade for admins)
  DELETE FROM products
  WHERE id = p_product_id;

  RETURN json_build_object(
    'success', true,
    'message', CASE 
      WHEN v_movements_count > 0 THEN 'Produto e todos os registros associados foram excluídos com sucesso.'
      ELSE 'Produto excluído com sucesso.'
    END
  );
END;
$$;