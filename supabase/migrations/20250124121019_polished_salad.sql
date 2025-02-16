/*
  # Fix requisitions policies

  1. Changes
    - Drop all existing policies for requisitions table
    - Create new simplified policies that allow:
      - Public read access
      - Public creation of new requisitions
      - Status updates for all requisitions
      - No restrictions on status changes between 'pending' and 'delivered'

  2. Security
    - Maintains basic RLS while allowing necessary operations
    - Ensures data integrity with status checks
*/

-- Drop all existing policies for requisitions to start fresh
DROP POLICY IF EXISTS "Allow public create requisitions" ON requisitions;
DROP POLICY IF EXISTS "Allow public read requisitions" ON requisitions;
DROP POLICY IF EXISTS "Allow public update own sector requisitions" ON requisitions;
DROP POLICY IF EXISTS "Allow public update requisition status" ON requisitions;
DROP POLICY IF EXISTS "Allow requisition updates" ON requisitions;

-- Create new simplified policies
CREATE POLICY "allow_read_requisitions"
  ON requisitions
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "allow_create_requisitions"
  ON requisitions
  FOR INSERT
  TO public
  WITH CHECK (status = 'pending');

CREATE POLICY "allow_update_requisitions"
  ON requisitions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (
    status IN ('pending', 'delivered')
  );