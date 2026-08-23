-- 1. Realtime: sem a tabela na publicacao, o painel de progresso nao recebe
--    nada e o disparo de outra aba fica invisivel, que e justamente o que se
--    quer resolver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_broadcasts;
  END IF;
END $$;

-- 2. RLS por grupo. A policy que existia era FOR ALL USING (true): qualquer
--    autenticado de qualquer grupo lia e escrevia os disparos de qualquer
--    hotel - e a coluna targets guarda a lista de telefones de quem recebeu,
--    que e dado pessoal. Mesmo padrao ja aplicado em whatsapp_configs
--    (20260822120000_whatsapp_config_group_scope.sql).
ALTER TABLE whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_wa_broadcasts" ON whatsapp_broadcasts;

CREATE POLICY "wa_broadcasts_own_group" ON whatsapp_broadcasts
  FOR ALL TO authenticated
  USING ((SELECT public.hotel_in_my_group(hotel_id)))
  WITH CHECK ((SELECT public.hotel_in_my_group(hotel_id)));
