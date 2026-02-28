/*
  # Correção da estrutura da tabela sectors

  1. Alterações
    - Adiciona coluna role na tabela sectors
    - Define valores padrão para os setores
  
  2. Segurança
    - Mantém as políticas existentes
*/

-- Adiciona coluna role se não existir
ALTER TABLE sectors
ADD COLUMN IF NOT EXISTS role text;

-- Adiciona constraint para role
ALTER TABLE sectors
ADD CONSTRAINT sectors_role_check
CHECK (role IN ('admin', 'management', 'inventory', 'regular'));

-- Define valores padrão para os setores existentes
UPDATE sectors
SET role = 'regular'
WHERE role IS NULL;

-- Atualiza setores específicos
UPDATE sectors
SET role = 'inventory'
WHERE name = 'Estoque';

UPDATE sectors
SET role = 'management'
WHERE name = 'Gerência';