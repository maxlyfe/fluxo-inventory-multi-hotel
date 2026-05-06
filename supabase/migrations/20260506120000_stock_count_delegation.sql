-- Migration: Stock Count Delegation (Link Público 24h)
-- Permite que supervisores gerem links temporários para colaboradores
-- realizarem contagens de stock sem login.

-- ── Tabela de tokens ─────────────────────────────────────────────────────────

CREATE TABLE public.stock_count_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  sector_id      uuid REFERENCES sectors(id) ON DELETE CASCADE,
  token          uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_by     uuid REFERENCES profiles(id),
  stock_count_id uuid REFERENCES stock_counts(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_count_tokens_token    ON public.stock_count_tokens (token);
CREATE INDEX idx_stock_count_tokens_hotel    ON public.stock_count_tokens (hotel_id);

ALTER TABLE public.stock_count_tokens ENABLE ROW LEVEL SECURITY;

-- Anon pode LER tokens (para validar o link)
CREATE POLICY "anon_read_tokens"
  ON public.stock_count_tokens FOR SELECT TO anon
  USING (true);

-- Authenticated pode gerir todos os seus tokens
CREATE POLICY "auth_all_tokens"
  ON public.stock_count_tokens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Nome do colaborador externo em stock_counts ───────────────────────────────

ALTER TABLE public.stock_counts
  ADD COLUMN IF NOT EXISTS counted_by_name text;

-- ── Políticas anon para o colaborador salvar a contagem ──────────────────────

-- stock_counts: anon INSERT (criar nova contagem delegada)
CREATE POLICY "anon_insert_stock_counts"
  ON public.stock_counts FOR INSERT TO anon
  WITH CHECK (true);

-- stock_counts: anon UPDATE (salvar rascunho → pendente)
CREATE POLICY "anon_update_stock_counts"
  ON public.stock_counts FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

-- stock_count_items: anon ALL (inserir/apagar itens contados)
CREATE POLICY "anon_all_stock_count_items"
  ON public.stock_count_items FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- sector_stock: anon SELECT (ler quantidades actuais do setor)
CREATE POLICY "anon_read_sector_stock"
  ON public.sector_stock FOR SELECT TO anon
  USING (true);
