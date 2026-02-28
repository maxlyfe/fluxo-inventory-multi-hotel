/*
  # Melhorias no sistema administrativo

  1. Alterações em Tabelas Existentes
    - Adiciona coluna `delivered_quantity` na tabela `requisitions`
    - Modifica coluna `status` para aceitar novo valor 'rejected'
    - Adiciona coluna `rejection_reason` para casos de rejeição
    - Adiciona coluna `role` na tabela `sectors` para identificar setores especiais

  2. Novas Tabelas
    - `item_consumption`: Registra o histórico de consumo de itens por setor
    
  3. Segurança
    - Atualiza políticas para incluir novos campos e status
*/

-- Adiciona novas colunas na tabela requisitions
ALTER TABLE requisitions 
ADD COLUMN IF NOT EXISTS delivered_quantity integer,
ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Modifica o tipo da coluna status com nova constraint
ALTER TABLE requisitions 
DROP CONSTRAINT IF EXISTS requisitions_status_check;

ALTER TABLE requisitions
ADD CONSTRAINT requisitions_status_check 
CHECK (status IN ('pending', 'delivered', 'rejected'));

-- Adiciona coluna role em sectors
ALTER TABLE sectors
ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE sectors
ADD CONSTRAINT sectors_role_check
CHECK (role IN ('admin', 'management', 'inventory', 'regular'));

-- Atualiza setores existentes
UPDATE sectors
SET role = 'regular'
WHERE role IS NULL;

-- Cria tabela de consumo
CREATE TABLE IF NOT EXISTS item_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid REFERENCES sectors(id),
  item_name text NOT NULL,
  quantity integer NOT NULL,
  consumed_at timestamptz DEFAULT now(),
  requisition_id uuid REFERENCES requisitions(id)
);

-- Habilita RLS para nova tabela
ALTER TABLE item_consumption ENABLE ROW LEVEL SECURITY;

-- Políticas para item_consumption
CREATE POLICY "allow_read_consumption"
  ON item_consumption
  FOR SELECT
  TO public
  USING (true);

-- Trigger para registrar consumo quando requisição é entregue
CREATE OR REPLACE FUNCTION record_item_consumption()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status = 'pending' THEN
    INSERT INTO item_consumption (
      sector_id,
      item_name,
      quantity,
      requisition_id
    ) VALUES (
      NEW.sector_id,
      NEW.item_name,
      COALESCE(NEW.delivered_quantity, NEW.quantity),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Criar trigger
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_record_consumption'
  ) THEN
    CREATE TRIGGER trigger_record_consumption
      AFTER UPDATE ON requisitions
      FOR EACH ROW
      EXECUTE FUNCTION record_item_consumption();
  END IF;
END $$;

-- Atualizar roles dos setores especiais
UPDATE sectors
SET role = 'inventory'
WHERE name = 'Estoque';

UPDATE sectors
SET role = 'management'
WHERE name = 'Gerência';

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_item_consumption_sector 
ON item_consumption(sector_id);

CREATE INDEX IF NOT EXISTS idx_item_consumption_item 
ON item_consumption(item_name);

CREATE INDEX IF NOT EXISTS idx_requisitions_status_updated 
ON requisitions(status, updated_at DESC);