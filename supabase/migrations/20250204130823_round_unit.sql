/*
  # Fix requisition update policies

  1. Changes
    - Add new policy to allow updating requisition status
    - Keep existing policies intact
    - Ensure proper access control for status updates

  2. Security
    - Maintain RLS enabled
    - Allow public to update status to 'delivered'
*/

-- Drop existing update policy to avoid conflicts
DROP POLICY IF EXISTS "allow_update_requisitions" ON requisitions;

-- Create new update policy with explicit status change permission
CREATE POLICY "allow_update_requisitions"
  ON requisitions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (
    CASE 
      WHEN NEW.status = OLD.status THEN true  -- Allow updating quantity
      WHEN NEW.status = 'delivered' AND OLD.status = 'pending' THEN true  -- Allow marking as delivered
      ELSE false  -- Prevent other status changes
    END
  );