/*
  # Fix RLS policies for requisitions table

  1. Changes
    - Drop existing update policies to avoid conflicts
    - Create new comprehensive update policy
    - Ensure proper access for status updates
    
  2. Security
    - Allows updating requisition status and other fields
    - Maintains data integrity with status validation
*/

-- Drop existing update policies to avoid conflicts
DROP POLICY IF EXISTS "Allow public update requisition status" ON requisitions;
DROP POLICY IF EXISTS "Allow public update own sector requisitions" ON requisitions;

-- Create new comprehensive update policy
CREATE POLICY "Allow requisition updates"
  ON requisitions
  FOR UPDATE
  USING (true)
  WITH CHECK (
    CASE 
      WHEN NEW.status = OLD.status THEN true  -- Allow updating other fields
      WHEN NEW.status IN ('pending', 'delivered') THEN true  -- Allow status changes to valid values
      ELSE false
    END
  );