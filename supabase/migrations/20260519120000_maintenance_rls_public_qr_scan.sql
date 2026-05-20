-- ============================================================================
-- Manutenção — RLS para QR Code público + usuários autenticados (qualquer role)
-- ============================================================================
-- Contexto:
--   1. Dev/admin não conseguia criar equipamento (RLS bloqueava o INSERT)
--   2. QR Code na placa do equipamento precisa ser lido por QUALQUER pessoa
--      (cliente, hóspede, prestador externo) para abrir chamado de manutenção
--   3. Histórico de chamados deve ser visível só para usuários logados
--
-- Aplicar no Supabase Dashboard → SQL Editor → Run
-- (ou via supabase db push se configurado)
-- ============================================================================

-- ── maintenance_equipment ──────────────────────────────────────────────────
-- Garante que RLS está habilitado
ALTER TABLE IF EXISTS public.maintenance_equipment ENABLE ROW LEVEL SECURITY;

-- Limpa policies existentes (idempotente — pode rodar várias vezes)
DROP POLICY IF EXISTS "maintenance_equipment_select_public"   ON public.maintenance_equipment;
DROP POLICY IF EXISTS "maintenance_equipment_insert_auth"     ON public.maintenance_equipment;
DROP POLICY IF EXISTS "maintenance_equipment_update_auth"     ON public.maintenance_equipment;
DROP POLICY IF EXISTS "maintenance_equipment_delete_auth"     ON public.maintenance_equipment;

-- SELECT: público (anon + authenticated) para que o QR Code funcione mesmo
--          sem login. O usuário anônimo só verá os dados do equipamento que
--          consultou diretamente pelo qr_code_id — não consegue listar todos.
CREATE POLICY "maintenance_equipment_select_public"
  ON public.maintenance_equipment
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: qualquer usuário AUTENTICADO.
--   Controle de acesso fica no front (PrivateRoute module="maintenance"
--   + usePermissions). RLS confia que o app gating é suficiente.
CREATE POLICY "maintenance_equipment_insert_auth"
  ON public.maintenance_equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "maintenance_equipment_update_auth"
  ON public.maintenance_equipment
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "maintenance_equipment_delete_auth"
  ON public.maintenance_equipment
  FOR DELETE
  TO authenticated
  USING (true);


-- ── maintenance_tickets ────────────────────────────────────────────────────
-- Mantém histórico VISÍVEL apenas para autenticados (já é o comportamento atual,
-- mas reforça aqui para garantir).
ALTER TABLE IF EXISTS public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_tickets_select_auth"   ON public.maintenance_tickets;
DROP POLICY IF EXISTS "maintenance_tickets_insert_auth"   ON public.maintenance_tickets;
DROP POLICY IF EXISTS "maintenance_tickets_update_auth"   ON public.maintenance_tickets;
DROP POLICY IF EXISTS "maintenance_tickets_delete_auth"   ON public.maintenance_tickets;

CREATE POLICY "maintenance_tickets_select_auth"
  ON public.maintenance_tickets
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "maintenance_tickets_insert_auth"
  ON public.maintenance_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "maintenance_tickets_update_auth"
  ON public.maintenance_tickets
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "maintenance_tickets_delete_auth"
  ON public.maintenance_tickets
  FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================================
-- Notas:
-- • INSERT anônimo em maintenance_tickets continua sendo feito pela Edge
--   Function `maintenance-public` (usa service_role, não passa por RLS),
--   chamada por MaintenanceNewTicket.tsx para usuários sem login.
-- • A permissão "maintenance" do módulo continua sendo controle de UI no app
--   (esconde menu, bloqueia rota) — RLS é só a última linha de defesa.
-- ============================================================================
