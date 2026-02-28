-- Migration to safely consolidate authentication towards Supabase native system
-- This script is NON-DESTRUCTIVE.

-- Step 1: Add a new column to your existing 'auth_users' table.
-- This column will store the ID from Supabase's real 'auth.users' table,
-- creating a link between your custom table and the native one.
ALTER TABLE public.auth_users
ADD COLUMN IF NOT EXISTS supabase_auth_id UUID;

-- Step 2: Create a unique index on the new column to ensure data integrity
-- and faster lookups. This prevents linking one Supabase Auth user to
-- multiple profiles in your custom table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_supabase_auth_id
ON public.auth_users(supabase_auth_id)
WHERE supabase_auth_id IS NOT NULL;

-- Step 3: Create a server-side function to create a user.
-- This function will now do two things:
-- 1. Create the user in the native Supabase Authentication system.
-- 2. Create a corresponding entry in your public.auth_users table, linking the two.
CREATE OR REPLACE FUNCTION create_user_and_profile(
  p_email text,
  p_password text,
  p_role text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id uuid;
  v_profile_id uuid;
  v_error_message text;
BEGIN
  -- Validate role
  IF p_role NOT IN ('admin', 'inventory', 'management', 'sup-governanca') THEN
    RAISE EXCEPTION 'Role inválida: %', p_role;
  END IF;

  -- Create the user in the native Supabase auth system
  -- Note: This part requires the "supabase_admin" role to execute.
  -- Ensure your database user has the necessary permissions.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_token, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (current_setting('app.instance_id')::uuid, gen_random_uuid(), 'authenticated', 'authenticated', p_email, crypt(p_password, gen_salt('bf')), now(), '', null, null, '{"provider":"email","providers":["email"]}', json_build_object('role', p_role), now(), now())
  RETURNING id INTO v_auth_user_id;

  -- Create the corresponding profile in your public.auth_users table
  INSERT INTO public.auth_users (email, password_hash, role, supabase_auth_id)
  VALUES (p_email, crypt(p_password, gen_salt('bf')), p_role, v_auth_user_id)
  RETURNING id INTO v_profile_id;
  
  RETURN 'Usuário e perfil criados com sucesso. ID Auth: ' || v_auth_user_id;

EXCEPTION WHEN unique_violation THEN
  -- Handle cases where email already exists
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  IF v_error_message LIKE '%auth.users_email_key%' THEN
    RAISE EXCEPTION 'Este e-mail já está cadastrado no sistema de autenticação do Supabase.';
  ELSIF v_error_message LIKE '%auth_users_email_key%' THEN
    RAISE EXCEPTION 'Este e-mail já está cadastrado na tabela de perfis de usuário.';
  ELSE
    RAISE EXCEPTION 'Erro de violação de unicidade: %', v_error_message;
  END IF;
WHEN OTHERS THEN
  -- Catch any other errors
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  RAISE EXCEPTION 'Erro inesperado ao criar usuário: %', v_error_message;
END;
$$;

-- Note: The logic for updating roles and passwords should now be done
-- via the UserManagement.tsx page, which will call supabase.auth.admin functions.
-- The old change_user_role and change_user_password functions can be deprecated.
-- Dropping them is optional but recommended for cleanup in a future step.
-- DROP FUNCTION IF EXISTS change_user_role(uuid, text);
-- DROP FUNCTION IF EXISTS change_user_password(uuid, text);

COMMENT ON FUNCTION create_user_and_profile IS 'Creates a user in Supabase Auth and a corresponding profile in public.auth_users, linking them.';