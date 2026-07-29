-- ============================================================================
-- Fecha resolve_username_email para o público
-- ============================================================================
-- A função (criada em 20260717130000_username_login.sql) traduz username →
-- e-mail real e estava com GRANT para anon. Isso permitia a qualquer visitante
-- colher os e-mails de todos os funcionários de um grupo, um username por vez.
--
-- A partir de agora a tradução acontece dentro da Edge Function `auth-login`,
-- que roda com service_role. Nada muda na tela: o login por username continua
-- funcionando igual.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.resolve_username_email(TEXT, UUID)
  FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_username_email(TEXT, UUID)
  TO service_role;

-- Conferir (deve falhar como anon e funcionar como service_role):
--   SELECT resolve_username_email('algum.usuario', '<group_uuid>');
-- ============================================================================
