-- ============================================================================
-- ATOMIC STOCK OPERATIONS: PREVENTING RACE CONDITIONS & DUPLICITY
-- Data: 01/05/2026
-- ============================================================================

/**
 * Função: decrement_sector_stock
 * Objetivo: Realiza a baixa de estoque de forma atômica no servidor.
 * Vantagem: Impede que dois usuários descontando o mesmo item causem erros no saldo.
 */
CREATE OR REPLACE FUNCTION public.decrement_sector_stock(
  p_hotel_id UUID,
  p_sector_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.sector_stock
  SET 
    quantity = quantity - p_quantity,
    updated_at = NOW()
  WHERE 
    hotel_id = p_hotel_id AND 
    sector_id = p_sector_id AND 
    product_id = p_product_id;

  -- Opcional: Se quiser logs de erro caso o produto não exista no setor
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado no estoque deste setor.';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Função: increment_sector_stock
 * Objetivo: Aumenta o estoque de forma atômica (útil para estornos ou recebimentos).
 */
CREATE OR REPLACE FUNCTION public.increment_sector_stock(
  p_hotel_id UUID,
  p_sector_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.sector_stock
  SET 
    quantity = quantity + p_quantity,
    updated_at = NOW()
  WHERE 
    hotel_id = p_hotel_id AND 
    sector_id = p_sector_id AND 
    product_id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
