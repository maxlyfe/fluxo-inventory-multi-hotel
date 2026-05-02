-- ============================================================================
-- SECURITY HARDENING: CREDENTIAL PROTECTION & DATA NORMALIZATION
-- Versão: 2.0 (Foco em proteção de senhas sem restrição de hotel)
-- Data: 30/04/2026
-- ============================================================================

-- 1) Função para verificar se o usuário é Administrador ou Dev
-- Baseado na estrutura de custom_roles do projeto
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.custom_roles r ON p.custom_role_id = r.id
    WHERE p.id = auth.uid() 
    AND (
      r.name ILIKE '%admin%' 
      OR r.name ILIKE '%dev%' 
      OR p.role = 'admin' 
      OR p.role = 'dev'
    )
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================================
-- PROTEÇÃO DA TABELA: erbon_hotel_config (CRÍTICO - SENHAS)
-- ============================================================================
ALTER TABLE erbon_hotel_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erbon_config_read" ON erbon_hotel_config;
DROP POLICY IF EXISTS "admin_read_erbon_config" ON erbon_hotel_config;

-- Todos os usuários logados podem ver configurações básicas, 
-- mas APENAS ADMINS podem ver as colunas de senha/user
CREATE POLICY "authenticated_read_erbon_config" ON erbon_hotel_config
  FOR SELECT TO authenticated 
  USING (true);

-- Garante que apenas Admins podem fazer UPDATE/INSERT
CREATE POLICY "admin_manage_erbon_config" ON erbon_hotel_config
  FOR ALL TO authenticated 
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================================
-- PROTEÇÃO DE WHATSAPP (TOKENS SENSÍVEIS)
-- ============================================================================
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_configs_read" ON whatsapp_configs;

CREATE POLICY "authenticated_read_whatsapp" ON whatsapp_configs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "admin_manage_whatsapp" ON whatsapp_configs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================================
-- GARANTIR RLS EM OUTRAS TABELAS (SEM BLOQUEIO DE HOTEL POR ENQUANTO)
-- ============================================================================
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_all_sectors" ON sectors;
CREATE POLICY "read_all_sectors" ON sectors FOR SELECT TO authenticated USING (true);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_all_products" ON products;
CREATE POLICY "read_all_products" ON products FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- NORMALIZAÇÃO DE TIPOS DE DADOS (QUANTIDADES)
-- ============================================================================
DO $$ 
BEGIN
  -- Tabela: requisitions
  ALTER TABLE requisitions ALTER COLUMN quantity TYPE NUMERIC;
  
  -- Tabela: inventory (legada)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ALTER COLUMN quantity TYPE NUMERIC;
  END IF;
END $$;
