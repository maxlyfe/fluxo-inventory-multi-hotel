/*
  # Configuração completa do banco de dados

  1. Novas Tabelas
    - Adiciona tabela de histórico de movimentações
    - Adiciona tabela de categorias de itens
  
  2. Alterações
    - Adiciona novas colunas em inventory
    - Adiciona constraints e relacionamentos
  
  3. Segurança
    - Habilita RLS para novas tabelas
    - Adiciona políticas de acesso
*/

-- Criar tabela de categorias
CREATE TABLE IF NOT EXISTS item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Criar tabela de histórico de movimentações
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES inventory(id),
  quantity_change integer NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('entrada', 'saida', 'ajuste')),
  reason text,
  performed_by text,
  created_at timestamptz DEFAULT now()
);

-- Adicionar novas colunas em inventory
ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS minimum_stock integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES item_categories(id),
ADD COLUMN IF NOT EXISTS unit text DEFAULT 'unidade',
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS location text;

-- Habilitar RLS para novas tabelas
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Criar políticas para item_categories
CREATE POLICY "allow_read_categories"
  ON item_categories
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "allow_inventory_manage_categories"
  ON item_categories
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM sectors
      WHERE sectors.inventory_manager = true
    )
  );

-- Criar políticas para inventory_movements
CREATE POLICY "allow_read_movements"
  ON inventory_movements
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "allow_inventory_manage_movements"
  ON inventory_movements
  FOR INSERT
  TO public
  USING (true)
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sectors
      WHERE sectors.inventory_manager = true
    )
  );

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_inventory_category
ON inventory(category_id);

CREATE INDEX IF NOT EXISTS idx_inventory_minimum_stock
ON inventory(minimum_stock)
WHERE quantity <= minimum_stock;

CREATE INDEX IF NOT EXISTS idx_movements_item
ON inventory_movements(item_id, created_at DESC);

-- Adicionar comentários para documentação
COMMENT ON TABLE item_categories IS 'Categorias de itens do estoque';
COMMENT ON TABLE inventory_movements IS 'Histórico de movimentações do estoque';
COMMENT ON COLUMN inventory.minimum_stock IS 'Quantidade mínima que deve ser mantida em estoque';
COMMENT ON COLUMN inventory.unit IS 'Unidade de medida do item';
COMMENT ON COLUMN inventory.location IS 'Localização física do item no estoque';