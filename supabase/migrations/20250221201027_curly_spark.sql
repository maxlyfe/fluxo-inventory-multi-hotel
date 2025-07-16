/*
  # Funções de Gerenciamento de Usuários

  1. Novas Funções
    - create_user: Cria um novo usuário com email, senha e role
    - change_user_password: Altera a senha de um usuário existente

  2. Segurança
    - Funções são SECURITY DEFINER para executar com privilégios elevados
    - Validações de entrada para garantir dados corretos
*/

-- Função para criar novo usuário
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
  IF p_role NOT IN ('admin', 'inventory', 'management') THEN
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

-- Função para alterar senha
CREATE OR REPLACE FUNCTION change_user_password(
  p_user_id uuid,
  p_new_password text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validar senha
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Nova senha deve ter pelo menos 6 caracteres';
  END IF;

  -- Atualizar senha
  UPDATE auth_users
  SET password_hash = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
END;
$$;

-- Adicionar comentários
COMMENT ON FUNCTION create_user IS 'Cria um novo usuário com email, senha e role';
COMMENT ON FUNCTION change_user_password IS 'Altera a senha de um usuário existente';