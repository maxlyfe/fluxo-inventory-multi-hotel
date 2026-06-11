-- ============================================================================
-- MELHORIA PARA REQUISIÇÕES PÚBLICAS: UPSERT (ATUALIZAR INVÉS DE DUPLICAR)
-- ============================================================================

-- Atualiza a função de envio para suportar atualização de pedidos pendentes
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
  -- 1. Validar token
  SELECT t.hotel_id, t.sector_id INTO v_hotel, v_sector
  FROM sector_request_tokens t
  WHERE t.token = p_token AND t.expires_at > now();
  
  IF v_hotel IS NULL THEN
    RAISE EXCEPTION 'Link inválido ou expirado.';
  END IF;

  -- 2. Validar inputs
  IF length(trim(coalesce(p_requester_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do colaborador.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;

  -- 3. Verificar se já existe um pedido PENDENTE deste mesmo item para este solicitante
  -- Para produtos catalogados, busca por product_id
  -- Para itens avulsos, busca por item_name (exato)
  IF p_product_id IS NOT NULL THEN
    SELECT id INTO v_existing_id 
    FROM requisitions 
    WHERE sector_id = v_sector 
      AND product_id = p_product_id 
      AND status = 'pending'
      AND notes LIKE 'PUB:' || p_requester_id || ':%'
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id 
    FROM requisitions 
    WHERE sector_id = v_sector 
      AND product_id IS NULL
      AND item_name = trim(p_item_name)
      AND status = 'pending'
      AND notes LIKE 'PUB:' || p_requester_id || ':%'
    LIMIT 1;
  END IF;

  -- 4. Inserir ou Atualizar
  IF v_existing_id IS NOT NULL THEN
    UPDATE requisitions 
    SET 
      quantity = p_quantity, 
      item_name = trim(p_item_name),
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
