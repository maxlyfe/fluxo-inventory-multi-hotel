-- Função para alterar role do usuário
CREATE OR REPLACE FUNCTION change_user_role(
  p_user_id uuid,
  p_new_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validar role
  IF p_new_role NOT IN ('admin', 'inventory', 'management') THEN
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

COMMENT ON FUNCTION change_user_role IS 'Altera a função (role) de um usuário existente';