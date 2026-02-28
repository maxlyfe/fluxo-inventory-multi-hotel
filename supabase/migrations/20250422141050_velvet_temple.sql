/*
  # Add Kitchen and Restaurant Sectors

  1. Changes
    - Add kitchen and restaurant sectors if they don't exist
    - Update governance sector role to match constraint
    - Use valid role values from sectors_role_check constraint
*/

-- First check if sectors exist
DO $$ 
BEGIN
  -- Insert kitchen sector if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM sectors 
    WHERE name = 'Cozinha' 
    AND hotel_id = '11111111-1111-1111-1111-111111111111'
  ) THEN
    INSERT INTO sectors (id, name, role, hotel_id)
    VALUES (
      gen_random_uuid(),
      'Cozinha',
      'regular',
      '11111111-1111-1111-1111-111111111111'
    );
  END IF;

  -- Insert restaurant sector if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM sectors 
    WHERE name = 'Restaurante' 
    AND hotel_id = '11111111-1111-1111-1111-111111111111'
  ) THEN
    INSERT INTO sectors (id, name, role, hotel_id)
    VALUES (
      gen_random_uuid(),
      'Restaurante',
      'regular',
      '11111111-1111-1111-1111-111111111111'
    );
  END IF;

  -- Update governance sector role
  UPDATE sectors 
  SET role = 'management'
  WHERE name = 'Governança'
  AND hotel_id = '11111111-1111-1111-1111-111111111111';
END $$;