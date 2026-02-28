/*
  # Authentication Setup

  1. New Tables
    - `auth_users`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `password_hash` (text)
      - `role` (text)
      - `created_at` (timestamp)
      - `last_login` (timestamp)

  2. Security
    - Enable RLS on `auth_users` table
    - Add policies for secure access
*/

-- Create auth_users table
CREATE TABLE IF NOT EXISTS auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'inventory', 'management')),
  created_at timestamptz DEFAULT now(),
  last_login timestamptz
);

-- Enable RLS
ALTER TABLE auth_users ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can read own data"
  ON auth_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Function to handle login
CREATE OR REPLACE FUNCTION handle_login(
  p_email text,
  p_password text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user auth_users;
  v_token text;
BEGIN
  -- Get user
  SELECT * INTO v_user
  FROM auth_users
  WHERE email = p_email
  AND password_hash = crypt(p_password, password_hash);

  -- If user not found
  IF v_user.id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Invalid credentials'
    );
  END IF;

  -- Update last login
  UPDATE auth_users
  SET last_login = now()
  WHERE id = v_user.id;

  -- Return success with user data
  RETURN json_build_object(
    'success', true,
    'user', json_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'role', v_user.role
    )
  );
END;
$$;