/*
  # Add policy for updating requisition status

  1. Changes
    - Add new policy to allow updating requisition status to 'delivered'
    
  2. Security
    - Allows public to update requisition status
    - Restricts status values to 'pending' or 'delivered' only
*/

CREATE POLICY "Allow public update requisition status"
  ON requisitions
  FOR UPDATE
  USING (true)
  WITH CHECK (status IN ('pending', 'delivered'));