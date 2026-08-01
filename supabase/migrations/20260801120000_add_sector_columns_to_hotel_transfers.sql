-- ============================================================================
-- hotel_transfers: origem e destino em nível de SETOR
-- ============================================================================
-- CONTEXTO:
--   Transferências entre hotéis podem sair do estoque principal (produtos) ou
--   de um estoque setorial (/sector-stock/:id → "Transferir"). Até aqui, as que
--   saíam de setor só gravavam essa informação em texto livre no campo `notes`
--   ("Setor: Cozinha → Restaurante (Brava Club)"), o que impede filtrar,
--   agrupar e auditar por setor no histórico (/inventory/transfers).
--
-- O QUE MUDA:
--   1. Duas colunas opcionais: source_sector_id / destination_sector_id.
--      NULL = a ponta é o estoque principal do hotel (comportamento legado).
--   2. Backfill best-effort das linhas antigas, lendo o padrão gravado em
--      `notes` e casando o nome do setor dentro do hotel correspondente.
--      O que não casar continua NULL — a UI faz fallback lendo `notes`.
--
-- O trigger handle_hotel_transfer NÃO é afetado: ele só roda em
-- BEFORE UPDATE pending→completed (estoque principal), e as transferências
-- setoriais entram com INSERT já 'completed', mexendo em sector_stock via RPC.
--
-- Aplicar via SQL Editor no Supabase Dashboard.
-- ============================================================================

ALTER TABLE hotel_transfers
  ADD COLUMN IF NOT EXISTS source_sector_id uuid,
  ADD COLUMN IF NOT EXISTS destination_sector_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotel_transfers_source_sector_id_fkey'
  ) THEN
    ALTER TABLE hotel_transfers
      ADD CONSTRAINT hotel_transfers_source_sector_id_fkey
      FOREIGN KEY (source_sector_id) REFERENCES sectors(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotel_transfers_destination_sector_id_fkey'
  ) THEN
    ALTER TABLE hotel_transfers
      ADD CONSTRAINT hotel_transfers_destination_sector_id_fkey
      FOREIGN KEY (destination_sector_id) REFERENCES sectors(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_transfers_source_sector
  ON hotel_transfers(source_sector_id) WHERE source_sector_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hotel_transfers_destination_sector
  ON hotel_transfers(destination_sector_id) WHERE destination_sector_id IS NOT NULL;

COMMENT ON COLUMN hotel_transfers.source_sector_id IS
  'Setor de origem quando a transferência sai de um estoque setorial. NULL = estoque principal do hotel de origem.';
COMMENT ON COLUMN hotel_transfers.destination_sector_id IS
  'Setor de destino quando a transferência entra em um estoque setorial. NULL = estoque principal do hotel de destino.';

-- ── Backfill das linhas antigas a partir do padrão em `notes` ───────────────
-- Formato gravado pelo SectorStock: 'Setor: <origem> → <destino> (<hotel destino>)'
UPDATE hotel_transfers ht
SET source_sector_id      = x.src_id,
    destination_sector_id = x.dst_id
FROM (
  SELECT
    p.id,
    (SELECT s.id FROM sectors s
      WHERE s.hotel_id = p.src_hotel
        AND LOWER(TRIM(s.name)) = LOWER(p.src_name)
      LIMIT 1) AS src_id,
    (SELECT s.id FROM sectors s
      WHERE s.hotel_id = p.dst_hotel
        AND LOWER(TRIM(s.name)) = LOWER(p.dst_name)
      LIMIT 1) AS dst_id
  FROM (
    SELECT
      id,
      source_hotel_id      AS src_hotel,
      destination_hotel_id AS dst_hotel,
      LOWER(TRIM(SUBSTRING(notes FROM 'Setor:\s*(.*?)\s*→')))   AS src_name,
      LOWER(TRIM(SUBSTRING(notes FROM '→\s*(.*?)\s*\(')))       AS dst_name
    FROM hotel_transfers
    WHERE notes LIKE 'Setor:%'
      AND source_sector_id IS NULL
      AND destination_sector_id IS NULL
  ) p
) x
WHERE ht.id = x.id
  AND (x.src_id IS NOT NULL OR x.dst_id IS NOT NULL);
