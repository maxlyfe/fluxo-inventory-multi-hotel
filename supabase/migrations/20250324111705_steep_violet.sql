/*
  # Add Admin User

  1. Changes
    - Add admin user with email admin@costadosol.com
    - Password: admin123
    - Role: admin
*/

-- Insert admin user
INSERT INTO auth_users (email, password_hash, role)
VALUES (
  'admin@costadosol.com',
  crypt('admin123', gen_salt('bf')),
  'admin'
)
ON CONFLICT (email) 
DO UPDATE SET 
  password_hash = crypt('admin123', gen_salt('bf')),
  role = 'admin';

COMMENT ON TABLE auth_users IS 'System users with authentication and authorization';