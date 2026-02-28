/*
  # Add Users Migration

  1. New Users
    - Add max@costadosol.com user with inventory role
    - Add max@hotel.com user with management role
*/

-- Insert users with encrypted passwords
INSERT INTO auth_users (email, password_hash, role)
VALUES 
  (
    'max@costadosol.com',
    crypt('29122015', gen_salt('bf')),
    'inventory'
  ),
  (
    'max@hotel.com',
    crypt('29122015', gen_salt('bf')),
    'management'
  )
ON CONFLICT (email) 
DO UPDATE SET 
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role;