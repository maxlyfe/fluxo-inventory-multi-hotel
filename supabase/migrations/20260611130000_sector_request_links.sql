-- ============================================================================
-- LINKS PÚBLICOS TEMPORÁRIOS DE REQUISIÇÃO POR SETOR
-- ============================================================================
-- Admin gera links com validade para setores do hotel; colaboradores SEM login
-- abrem o link, informam o nome e fazem pedidos de material para o setor.
--
-- Anon não lê products/sectors diretamente (RLS) — todo o acesso público passa
-- por RPCs SECURITY DEFINER validadas pelo token (existe + não expirado).
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── 1. Tabela de tokens ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sector_request_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE,
  hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  sector_id  UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srt_token ON sector_request_tokens(token);

ALTER TABLE sector_request_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "srt_auth_all" ON sector_request_tokens;
CREATE POLICY "srt_auth_all" ON sector_request_tokens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
-- anon: nenhuma policy — acesso só pelas RPCs abaixo

-- ── 2. Info do link (nome do hotel/setor para a tela pública) ────────────────
CREATE OR REPLACE FUNCTION get_request_link_info(p_token TEXT)
RETURNS TABLE(hotel_id UUID, hotel_name TEXT, sector_id UUID, sector_name TEXT, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.hotel_id, h.name, t.sector_id, s.name, t.expires_at
  FROM sector_request_tokens t
  JOIN hotels  h ON h.id = t.hotel_id
  JOIN sectors s ON s.id = t.sector_id
  WHERE t.token = p_token AND t.expires_at > now()
  LIMIT 1;
$$;

-- ── 3. Produtos visíveis para o setor do link ────────────────────────────────
-- Mesma regra do carrinho logado: products ativos do hotel; se o setor tem
-- visibilidade configurada (product_sector_visibility), filtra por ela.
CREATE OR REPLACE FUNCTION get_products_for_request_link(p_token TEXT)
RETURNS TABLE(id UUID, name TEXT, category TEXT, image_url TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel UUID; v_sector UUID; v_has_visibility BOOLEAN;
BEGIN
  SELECT t.hotel_id, t.sector_id INTO v_hotel, v_sector
  FROM sector_request_tokens t
  WHERE t.token = p_token AND t.expires_at > now();
  IF v_hotel IS NULL THEN RETURN; END IF;

  SELECT EXISTS (SELECT 1 FROM product_sector_visibility v WHERE v.sector_id = v_sector)
    INTO v_has_visibility;

  RETURN QUERY
  SELECT p.id, p.name, p.category, p.image_url
  FROM products p
  WHERE p.hotel_id = v_hotel
    AND COALESCE(p.is_active, true) = true
    AND (
      NOT v_has_visibility
      OR EXISTS (SELECT 1 FROM product_sector_visibility v
                 WHERE v.sector_id = v_sector AND v.product_id = p.id)
    )
  ORDER BY p.name;
END $$;

-- ── 4. Enviar requisição via link ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_request_via_link(
  p_token TEXT, p_requester_name TEXT,
  p_product_id UUID, p_item_name TEXT, p_quantity NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel UUID; v_sector UUID; v_id UUID;
BEGIN
  SELECT t.hotel_id, t.sector_id INTO v_hotel, v_sector
  FROM sector_request_tokens t
  WHERE t.token = p_token AND t.expires_at > now();
  IF v_hotel IS NULL THEN
    RAISE EXCEPTION 'Link inválido ou expirado.';
  END IF;

  IF length(trim(coalesce(p_requester_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do colaborador.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;
  IF length(trim(coalesce(p_item_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Item sem nome.';
  END IF;

  INSERT INTO requisitions (
    sector_id, product_id, item_name, quantity, status, is_custom,
    hotel_id, created_by, notes
  ) VALUES (
    v_sector, p_product_id, trim(p_item_name), p_quantity, 'pending',
    p_product_id IS NULL, v_hotel, NULL,
    'Pedido via link público — ' || trim(p_requester_name)
  ) RETURNING requisitions.id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION get_request_link_info(TEXT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_products_for_request_link(TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_request_via_link(TEXT, TEXT, UUID, TEXT, NUMERIC) TO anon, authenticated;

-- TESTE: SELECT * FROM get_request_link_info('<token>');
-- ============================================================================
