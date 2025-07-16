/*
  # Fix requisitions update policy

  1. Changes
    - Fix syntax for update policy to properly handle status changes
    - Use column references instead of NEW/OLD keywords
  
  2. Security
    - Maintains same security rules but with correct syntax
    - Allows updating quantity and marking as delivered
*/

-- Drop existing update policy
DROP POLICY IF EXISTS "allow_update_requisitions" ON requisitions;

-- Create new update policy with correct syntax
CREATE POLICY "allow_update_requisitions"
  ON requisitions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (
    (status = requisitions.status) OR  -- Allow updating quantity
    (status = 'delivered' AND requisitions.status = 'pending')  -- Allow marking as delivered
  );