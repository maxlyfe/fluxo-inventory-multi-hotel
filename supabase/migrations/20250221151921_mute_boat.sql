/*
  # Verify Users Migration

  1. Verify Users
    - Check if users exist and update if necessary
    - Ensure passwords are correctly hashed
*/

-- Re-insert users with encrypted passwords to ensure they exist
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
  password_hash = crypt('29122015', gen_salt('bf')),
  role = EXCLUDED.role;

-- Add logging to handle_login function
CREATE OR REPLACE FUNCTION handle_login(
  p_email text,
  p_password text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user auth_users;
  v_hashed_password text;
BEGIN
  -- Get user
  SELECT * INTO v_user
  FROM auth_users
  WHERE email = p_email;

  -- If user not found
  IF v_user.id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Usuário não encontrado'
    );
  END IF;

  -- Check password
  IF v_user.password_hash = crypt(p_password, v_user.password_hash) THEN
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
  ELSE
    RETURN json_build_object(
      'success', false,
      'message', 'Senha incorreta'
    );
  END IF;
END;
$$;