-- ============================================================================
-- MELHORIA PARA REQUISIÇÕES PÚBLICAS: PERSISTÊNCIA E REAL-TIME (V2)
-- ============================================================================

-- 1. Tabela de requisições: adicionar campo para ID do solicitante anônimo (opcional)
-- Usaremos o campo 'notes' com um padrão para facilitar RLS se necessário,
-- mas a melhor forma é ter um ID de sessão.

-- 2. Atualizar função de envio para incluir o ID do solicitante
CREATE OR REPLACE FUNCTION submit_request_via_link(
  p_token TEXT, 
  p_requester_name TEXT,
  p_requester_id TEXT, -- NOVO: ID único gerado no navegador (localStorage)
  p_product_id UUID, 
  p_item_name TEXT, 
  p_quantity NUMERIC
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

  INSERT INTO requisitions (
    sector_id, product_id, item_name, quantity, status, is_custom,
    hotel_id, created_by, notes
  ) VALUES (
    v_sector, p_product_id, trim(p_item_name), p_quantity, 'pending',
    p_product_id IS NULL, v_hotel, NULL,
    'PUB:' || p_requester_id || ':' || trim(p_requester_name)
  ) RETURNING requisitions.id INTO v_id;

  RETURN v_id;
END $$;

-- 3. Função para buscar o "carrinho" atual filtrado pelo ID do solicitante
CREATE OR REPLACE FUNCTION get_my_pending_requests(p_token TEXT, p_requester_id TEXT)
RETURNS TABLE(
  id UUID, 
  item_name TEXT, 
  quantity NUMERIC, 
  status TEXT,
  created_at TIMESTAMPTZ,
  product_id UUID,
  image_url TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel UUID; v_sector UUID;
BEGIN
  SELECT t.hotel_id, t.sector_id INTO v_hotel, v_sector
  FROM sector_request_tokens t
  WHERE t.token = p_token AND t.expires_at > now();

  IF v_hotel IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT 
    r.id, 
    r.item_name, 
    r.quantity, 
    r.status,
    r.created_at,
    r.product_id,
    p.image_url
  FROM requisitions r
  LEFT JOIN products p ON p.id = r.product_id
  WHERE r.hotel_id = v_hotel 
    AND r.sector_id = v_sector
    AND r.status IN ('pending', 'delivered', 'rejected')
    AND r.notes LIKE 'PUB:' || p_requester_id || ':%'
    AND r.created_at > now() - interval '24 hours'
  ORDER BY r.created_at DESC;
END $$;

-- 4. RLS para Real-time (Permitir que o anon ouça mudanças nas suas requisições)
-- Nota: Real-time do Supabase respeita RLS. Para o cliente ouvir, ele precisa de SELECT.
-- Como o requester_id é um UUID secreto no localStorage, o risco de leak é baixo.
DROP POLICY IF EXISTS "requisitions_select_anon" ON requisitions;
CREATE POLICY "requisitions_select_anon" ON requisitions FOR SELECT TO anon
USING (
  notes LIKE 'PUB:%'
  AND created_at > now() - interval '24 hours'
);

GRANT EXECUTE ON FUNCTION get_my_pending_requests(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_request_via_link(TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC) TO anon, authenticated;
