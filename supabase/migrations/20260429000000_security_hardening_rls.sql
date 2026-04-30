-- ============================================================================
-- SECURITY HARDENING: MULTI-HOTEL ISOLATION & CREDENTIAL PROTECTION
-- Data: 29/04/2026
-- ============================================================================

-- 1) Função auxiliar para obter o hotel_id do usuário logado
-- Usamos 'security definer' para que ela ignore o RLS ao consultar a própria tabela de perfis
CREATE OR REPLACE FUNCTION public.get_my_hotel()
RETURNS uuid AS $$
  SELECT default_hotel_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 2) Função para verificar se o usuário é Administrador ou Dev
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (role IN ('admin', 'dev'))
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================================
-- PROTEÇÃO DA TABELA: erbon_hotel_config (CRÍTICO - SENHAS)
-- ============================================================================
DROP POLICY IF EXISTS "erbon_hotel_config_select" ON erbon_hotel_config;
DROP POLICY IF EXISTS "erbon_hotel_config_insert" ON erbon_hotel_config;
DROP POLICY IF EXISTS "erbon_hotel_config_update" ON erbon_hotel_config;
DROP POLICY IF EXISTS "erbon_hotel_config_delete" ON erbon_hotel_config;

-- Apenas admins do hotel podem ver as configurações de integração (inclui senhas)
CREATE POLICY "admin_read_erbon_config" ON erbon_hotel_config
  FOR SELECT TO authenticated 
  USING (is_admin() AND hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_erbon_config" ON erbon_hotel_config
  FOR ALL TO authenticated 
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DA TABELA: sectors
-- ============================================================================
DROP POLICY IF EXISTS "Allow public read sectors" ON sectors;
DROP POLICY IF EXISTS "sectors_select" ON sectors; -- Caso exista nome alternativo

CREATE POLICY "users_read_own_hotel_sectors" ON sectors
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_own_hotel_sectors" ON sectors
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DA TABELA: requisitions
-- ============================================================================
DROP POLICY IF EXISTS "Allow public read requisitions" ON requisitions;
DROP POLICY IF EXISTS "Allow public create requisitions" ON requisitions;
DROP POLICY IF EXISTS "Allow public update own sector requisitions" ON requisitions;

CREATE POLICY "users_read_own_hotel_requisitions" ON requisitions
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "users_create_own_hotel_requisitions" ON requisitions
  FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel());

CREATE POLICY "users_update_own_hotel_requisitions" ON requisitions
  FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel())
  WITH CHECK (hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DA TABELA: profiles (EVITAR LEITURA DE TODOS OS USUÁRIOS)
-- ============================================================================
DROP POLICY IF EXISTS "Users can read own data" ON profiles;

CREATE POLICY "users_read_self" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "admins_read_hotel_users" ON profiles
  FOR SELECT TO authenticated
  USING (is_admin() AND default_hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE ESTOQUE E MOVIMENTAÇÕES
-- ============================================================================
DROP POLICY IF EXISTS "Allow public read inventory" ON inventory;
DROP POLICY IF EXISTS "Allow admin manage inventory" ON inventory;

CREATE POLICY "users_read_own_hotel_products" ON products
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_own_hotel_products" ON products
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

CREATE POLICY "users_read_own_hotel_movements" ON inventory_movements
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "users_insert_own_hotel_movements" ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE DADOS FINANCEIROS (ERBON CACHE)
-- ============================================================================
DROP POLICY IF EXISTS "erbon_transaction_cache_select" ON erbon_transaction_cache;
DROP POLICY IF EXISTS "erbon_transaction_cache_insert" ON erbon_transaction_cache;
DROP POLICY IF EXISTS "erbon_transaction_cache_update" ON erbon_transaction_cache;
DROP POLICY IF EXISTS "erbon_transaction_cache_delete" ON erbon_transaction_cache;

CREATE POLICY "users_read_own_hotel_tx_cache" ON erbon_transaction_cache
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_own_hotel_tx_cache" ON erbon_transaction_cache
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE WHATSAPP (TOKENS SENSÍVEIS)
-- ============================================================================
DROP POLICY IF EXISTS "whatsapp_configs_select" ON whatsapp_configs;

CREATE POLICY "admin_read_whatsapp_config" ON whatsapp_configs
  FOR SELECT TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_whatsapp_config" ON whatsapp_configs
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE FORNECEDORES
-- ============================================================================
DROP POLICY IF EXISTS "supplier_contacts_select" ON supplier_contacts;

CREATE POLICY "users_read_own_hotel_suppliers" ON supplier_contacts
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_own_hotel_suppliers" ON supplier_contacts
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE MANUTENÇÃO
-- ============================================================================
CREATE POLICY "users_read_own_hotel_maintenance" ON maintenance_tickets
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "users_manage_own_hotel_maintenance" ON maintenance_tickets
  FOR ALL TO authenticated
  USING (hotel_id = get_my_hotel())
  WITH CHECK (hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE COMPRAS E PEDIDOS
-- ============================================================================
CREATE POLICY "users_read_own_hotel_purchases" ON purchase_orders
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "admin_manage_own_hotel_purchases" ON purchase_orders
  FOR ALL TO authenticated
  USING (is_admin() AND hotel_id = get_my_hotel())
  WITH CHECK (is_admin() AND hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DO PICK-UP REPORT (DIRETORIA)
-- ============================================================================
-- Como esta tabela foi criada recentemente, vamos garantir que ela seja privada por hotel
ALTER TABLE diretoria_pickup_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pickup_snapshots_select" ON diretoria_pickup_snapshots;

CREATE POLICY "users_read_own_hotel_pickup" ON diretoria_pickup_snapshots
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel());

CREATE POLICY "users_manage_own_hotel_pickup" ON diretoria_pickup_snapshots
  FOR ALL TO authenticated
  USING (hotel_id = get_my_hotel())
  WITH CHECK (hotel_id = get_my_hotel());

-- ============================================================================
-- PROTEÇÃO DE PERFIS DE ACESSO (ROLES)
-- ============================================================================
-- Impede que um admin de um hotel crie um perfil para usar em outro hotel
DROP POLICY IF EXISTS "custom_roles_select" ON custom_roles;

CREATE POLICY "users_read_own_hotel_roles" ON custom_roles
  FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel() OR hotel_id IS NULL); -- Permite roles globais (null)

CREATE POLICY "admin_manage_own_hotel_roles" ON custom_roles
  FOR ALL TO authenticated
  USING (is_admin() AND (hotel_id = get_my_hotel()))
  WITH CHECK (is_admin() AND (hotel_id = get_my_hotel()));

-- ============================================================================
-- NORMALIZAÇÃO DE TIPOS DE DADOS (QUANTIDADES)
-- ============================================================================
-- Algumas tabelas antigas usam INTEGER, o que impede decimais (ex: 1.5kg)
DO $$ 
BEGIN
  -- Tabela: requisitions
  ALTER TABLE requisitions ALTER COLUMN quantity TYPE NUMERIC;
  
  -- Tabela: inventory (legada)
  ALTER TABLE inventory ALTER COLUMN quantity TYPE NUMERIC;

  -- Tabela: maintenance_equipment (estoque de peças)
  -- Se houver colunas de quantidade nela, convertemos
END $$;
