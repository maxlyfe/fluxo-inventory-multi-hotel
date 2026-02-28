/*
  # Add sup-governanca role

  1. Changes
    - Add 'sup-governanca' to auth_users role check constraint
    - Update create_user and change_user_role functions to support new role
    - Add comments for documentation
*/

-- Update role check constraint
ALTER TABLE auth_users
DROP CONSTRAINT IF EXISTS auth_users_role_check;

ALTER TABLE auth_users
ADD CONSTRAINT auth_users_role_check
CHECK (role IN ('admin', 'inventory', 'management', 'sup-governanca'));

-- Update create_user function
CREATE OR REPLACE FUNCTION create_user(
  p_email text,
  p_password text,
  p_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validar role
  IF p_role NOT IN ('admin', 'inventory', 'management', 'sup-governanca') THEN
    RAISE EXCEPTION 'Role inválida';
  END IF;

  -- Validar email
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'Email é obrigatório';
  END IF;

  -- Validar senha
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Senha deve ter pelo menos 6 caracteres';
  END IF;

  -- Inserir novo usuário
  INSERT INTO auth_users (
    email,
    password_hash,
    role
  ) VALUES (
    p_email,
    crypt(p_password, gen_salt('bf')),
    p_role
  );
END;
$$;

-- Update change_user_role function
CREATE OR REPLACE FUNCTION change_user_role(
  p_user_id uuid,
  p_new_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validar role
  IF p_new_role NOT IN ('admin', 'inventory', 'management', 'sup-governanca') THEN
    RAISE EXCEPTION 'Role inválida';
  END IF;

  -- Atualizar role
  UPDATE auth_users
  SET role = p_new_role
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
END;
$$;

-- Add comments
COMMENT ON CONSTRAINT auth_users_role_check ON auth_users IS 'Ensures user roles are valid';
COMMENT ON FUNCTION create_user IS 'Creates a new user with email, password and role (admin, inventory, management, or sup-governanca)';
COMMENT ON FUNCTION change_user_role IS 'Changes the role of an existing user (admin, inventory, management, or sup-governanca)';