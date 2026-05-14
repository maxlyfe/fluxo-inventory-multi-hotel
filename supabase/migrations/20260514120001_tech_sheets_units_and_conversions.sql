-- ============================================================================
-- UNIDADES E CONVERSÕES EM FICHAS TÉCNICAS
-- Data: 14/05/2026
-- ============================================================================

-- 1. Adicionar coluna unit em dish_ingredients e side_ingredients
ALTER TABLE dish_ingredients ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE side_ingredients ADD COLUMN IF NOT EXISTS unit TEXT;

-- 2. Atualizar registros existentes com a unidade base do ingrediente
UPDATE dish_ingredients di
SET unit = i.unit
FROM ingredients i
WHERE di.ingredient_id = i.id AND di.unit IS NULL;

UPDATE side_ingredients si
SET unit = i.unit
FROM ingredients i
WHERE si.ingredient_id = i.id AND si.unit IS NULL;

-- 3. Adicionar coluna unit em dishes se não existir (para consistência, embora já tenhamos type)
-- Já temos 'type' em dishes, que separa prato/bebida.
