-- ============================================================================
-- MELHORIA PARA REQUISIÇÕES PÚBLICAS: CARRINHO COMPARTILHADO E NOMES
-- ============================================================================

-- 1. Função para buscar os pedidos pendentes do SETOR (compartilhado)
-- Remove o filtro de requester_id para que todos vejam o que já foi pedido.
CREATE OR REPLACE FUNCTION get_my_pending_requests(p_token TEXT, p_requester_id TEXT)
RETURNS TABLE(
  id UUID, 
  item_name TEXT, 
  quantity NUMERIC, 
  status TEXT,
  created_at TIMESTAMPTZ,
  product_id UUID,
  image_url TEXT,
  requester_name TEXT,
  is_mine BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel UUID; v_sector UUID;
BEGIN
  -- Validar token e pegar contexto
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
    p.image_url,
    -- Extrai o nome do solicitante da string 'PUB:id:Nome'
    CASE 
      WHEN r.notes LIKE 'PUB:%:%' THEN split_part(r.notes, ':', 3)
      ELSE 'Colaborador'
    END as requester_name,
    -- Verifica se foi este dispositivo que pediu (para permitir edição)
    r.notes LIKE 'PUB:' || p_requester_id || ':%' as is_mine
  FROM requisitions r
  LEFT JOIN products p ON p.id = r.product_id
  WHERE r.hotel_id = v_hotel 
    AND r.sector_id = v_sector
    AND (
      r.status = 'pending' -- Sempre mostra pendentes do setor
      OR (r.status IN ('delivered', 'rejected') AND r.created_at > now() - interval '12 hours') -- Histórico recente
    )
  ORDER BY r.status DESC, r.created_at DESC;
END $$;

-- 2. Garantir que a função de envio salve o nome corretamente
CREATE OR REPLACE FUNCTION submit_request_via_link(
  p_token TEXT, 
  p_requester_name TEXT,
  p_requester_id TEXT, 
  p_product_id UUID, 
  p_item_name TEXT, 
  p_quantity NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel UUID; v_sector UUID; v_id UUID;
  v_existing_id UUID;
BEGIN
  SELECT t.hotel_id, t.sector_id INTO v_hotel, v_sector
  FROM sector_request_tokens t
  WHERE t.token = p_token AND t.expires_at > now();
  
  IF v_hotel IS NULL THEN RAISE EXCEPTION 'Link inválido ou expirado.'; END IF;

  IF length(trim(coalesce(p_requester_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Informe o seu nome.';
  END IF;

  -- Busca pedido pendente DESTE dispositivo (requester_id) para evitar que um 
  -- usuário altere o pedido do outro sem querer, a menos que seja o mesmo item.
  -- Se o cliente quer que a quantidade seja alterada sem duplicidade, 
  -- vamos buscar por item no setor, independente de quem pediu? 
  -- "sem gerar duplicidade de itens" -> Melhor buscar por item no setor.
  
  IF p_product_id IS NOT NULL THEN
    SELECT id INTO v_existing_id 
    FROM requisitions 
    WHERE sector_id = v_sector 
      AND product_id = p_product_id 
      AND status = 'pending'
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id 
    FROM requisitions 
    WHERE sector_id = v_sector 
      AND product_id IS NULL
      AND lower(trim(item_name)) = lower(trim(p_item_name))
      AND status = 'pending'
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE requisitions 
    SET 
      quantity = p_quantity, 
      -- Atualiza quem pediu por último se for alteração
      notes = 'PUB:' || p_requester_id || ':' || trim(p_requester_name),
      updated_at = now()
    WHERE id = v_existing_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO requisitions (
      sector_id, product_id, item_name, quantity, status, is_custom,
      hotel_id, created_by, notes
    ) VALUES (
      v_sector, p_product_id, trim(p_item_name), p_quantity, 'pending',
      p_product_id IS NULL, v_hotel, NULL,
      'PUB:' || p_requester_id || ':' || trim(p_requester_name)
    ) RETURNING requisitions.id INTO v_id;
  END IF;

  RETURN v_id;
END $$;
