/*
  # Update Sector Roles and Add Stock Support

  1. Changes
    - Add new roles to sectors role check constraint
    - Update existing sectors with correct roles
    - Add indexes for role-based queries
*/

-- Update role check constraint
ALTER TABLE sectors
DROP CONSTRAINT IF EXISTS sectors_role_check;

ALTER TABLE sectors
ADD CONSTRAINT sectors_role_check
CHECK (role IN ('admin', 'management', 'inventory', 'regular', 'kitchen', 'restaurant', 'governance'));

-- Update sector roles
UPDATE sectors 
SET role = 'kitchen'
WHERE name = 'Cozinha'
AND hotel_id = '11111111-1111-1111-1111-111111111111';

UPDATE sectors 
SET role = 'restaurant'
WHERE name = 'Restaurante'
AND hotel_id = '11111111-1111-1111-1111-111111111111';

UPDATE sectors 
SET role = 'governance'
WHERE name = 'Governança'
AND hotel_id = '11111111-1111-1111-1111-111111111111';

-- Create index for role-based queries
CREATE INDEX IF NOT EXISTS idx_sectors_role
ON sectors(role)
WHERE role IN ('kitchen', 'restaurant', 'governance');