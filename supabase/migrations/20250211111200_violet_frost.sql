/*
  # Atualização do Sistema de Gestão de Estoque

  1. Alterações
    - Adiciona coluna `inventory_manager` na tabela `sectors` para identificar o setor de estoque
    - Adiciona coluna `can_manage_requests` na tabela `sectors` para controle de permissões
    - Adiciona coluna `notes` na tabela `requisitions` para observações gerais
    - Adiciona índices para melhorar performance de consultas frequentes

  2. Segurança
    - Atualiza políticas de RLS para refletir novas permissões
    - Adiciona políticas específicas para gestão de estoque
*/

-- Adiciona novas colunas na tabela sectors
ALTER TABLE sectors
ADD COLUMN IF NOT EXISTS inventory_manager boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS can_manage_requests boolean DEFAULT false;

-- Adiciona coluna de notas na tabela requisitions
ALTER TABLE requisitions
ADD COLUMN IF NOT EXISTS notes text;

-- Atualiza setores existentes
UPDATE sectors
SET inventory_manager = true,
    can_manage_requests = true
WHERE role = 'inventory';

UPDATE sectors
SET can_manage_requests = true
WHERE role = 'management';

-- Adiciona índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_sectors_inventory_manager
ON sectors(inventory_manager)
WHERE inventory_manager = true;

CREATE INDEX IF NOT EXISTS idx_sectors_can_manage
ON sectors(can_manage_requests)
WHERE can_manage_requests = true;

CREATE INDEX IF NOT EXISTS idx_requisitions_item_status
ON requisitions(item_name, status);

-- Atualiza políticas existentes
DO $$ 
BEGIN
  -- Política para leitura de requisições
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'allow_read_requisitions'
  ) THEN
    DROP POLICY allow_read_requisitions ON requisitions;
  END IF;

  -- Política para atualização de requisições
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'allow_update_requisitions'
  ) THEN
    DROP POLICY allow_update_requisitions ON requisitions;
  END IF;
END $$;

-- Cria novas políticas
CREATE POLICY "allow_read_requisitions"
ON requisitions FOR SELECT
TO public
USING (true);

CREATE POLICY "allow_inventory_update_requisitions"
ON requisitions FOR UPDATE
TO public
USING (
  EXISTS (
    SELECT 1 FROM sectors
    WHERE sectors.id = requisitions.sector_id
    AND (sectors.inventory_manager = true OR sectors.can_manage_requests = true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM sectors
    WHERE sectors.id = requisitions.sector_id
    AND (sectors.inventory_manager = true OR sectors.can_manage_requests = true)
  )
);

-- Adiciona comentários nas tabelas para documentação
COMMENT ON COLUMN sectors.inventory_manager IS 'Indica se o setor é responsável pelo estoque';
COMMENT ON COLUMN sectors.can_manage_requests IS 'Indica se o setor pode gerenciar requisições';
COMMENT ON COLUMN requisitions.notes IS 'Observações gerais sobre a requisição';