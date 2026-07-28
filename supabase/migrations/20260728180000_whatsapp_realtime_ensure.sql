-- ─────────────────────────────────────────────────────────────────────────────
-- Garante que o inbox receba atualização em tempo real
--
-- A migration do módulo de inbox já fazia ALTER PUBLICATION, mas com ADD TABLE
-- direto: se a tabela já estiver na publicação o comando falha, e num banco onde
-- a migration foi aplicada em partes o resultado fica indefinido.
--
-- Aqui a adição é condicional, então rodar de novo é seguro em qualquer estado.
--
-- A identidade de réplica fica no padrão de propósito: o inbox só usa old.id no
-- evento de DELETE, que a chave primária já cobre, e REPLICA IDENTITY FULL
-- aumentaria o WAL sem necessidade.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['whatsapp_conversations', 'whatsapp_messages'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Tabela % adicionada ao realtime', t;
    ELSE
      RAISE NOTICE 'Tabela % ja estava no realtime', t;
    END IF;
  END LOOP;
END $$;
