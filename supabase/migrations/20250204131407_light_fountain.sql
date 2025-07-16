/*
  # Fix RLS policy for requisitions updates

  1. Changes
    - Drop existing update policy
    - Create new policy with simpler conditions
    - Fix syntax for checking OLD and NEW records
  
  2. Security
    - Allow updating any field when status remains the same
    - Allow changing status from 'pending' to 'delivered'
    - Prevent other status changes
*/

-- Drop existing update policy
DROP POLICY IF EXISTS "allow_update_requisitions" ON requisitions;

-- Create new update policy with correct syntax for OLD/NEW record comparison
CREATE POLICY "allow_update_requisitions"
  ON requisitions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (
    CASE
      WHEN NEW.status = OLD.status THEN true  -- Allow updating other fields
      WHEN OLD.status = 'pending' AND NEW.status = 'delivered' THEN true  -- Allow marking as delivered
      ELSE false  -- Prevent other status changes
    END
  );