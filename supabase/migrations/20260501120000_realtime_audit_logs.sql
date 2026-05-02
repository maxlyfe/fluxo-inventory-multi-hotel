-- ============================================================================
-- REACTIVE INFRASTRUCTURE: REALTIME & AUDIT LOGS
-- Data: 01/05/2026
-- ============================================================================

-- 1) Criar tabela de Auditoria Centralizada
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID REFERENCES hotels(id),
  user_email TEXT,
  user_id UUID,
  table_name TEXT NOT NULL,
  record_id TEXT, -- ID do registro afetado (pode ser UUID ou ID numérico do Erbon)
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE', 'ERBON_UPDATE'
  old_data JSONB,
  new_data JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ativar RLS para logs (apenas leitura para autenticados)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_audit_logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_audit_logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 2) Ativar SUPABASE REALTIME
-- Nota: Isso adiciona as tabelas à publicação 'supabase_realtime'
-- Se a publicação não existir, ela será criada.
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Adicionar tabelas à transmissão em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE public.sector_stock;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.requisitions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;

-- 3) Função auxiliar para registrar logs facilmente via RPC (opcional)
CREATE OR REPLACE FUNCTION public.log_action(
  p_hotel_id UUID,
  p_table_name TEXT,
  p_record_id TEXT,
  p_action TEXT,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.audit_logs (
    hotel_id, user_email, user_id, table_name, record_id, action, old_data, new_data, notes
  ) VALUES (
    p_hotel_id, 
    (SELECT email FROM auth.users WHERE id = auth.uid()), 
    auth.uid(), 
    p_table_name, 
    p_record_id, 
    p_action, 
    p_old_data, 
    p_new_data, 
    p_notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
