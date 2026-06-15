-- ============================================================================
-- LIMPEZA DE TOKENS WEB-MOBILE QUANDO O APP NATIVO ESTÁ PRESENTE
-- ============================================================================
-- Problema: um celular com o APK instalado também pode ter um token de PUSH WEB
-- (de quando o usuário aceitou notificações no Chrome). A notificação web, ao
-- ser tocada, abre o NAVEGADOR (Service Worker faz clients.openWindow) e NÃO
-- passa pelo Android App Links. Resultado: "abre o site, não o app".
--
-- Solução: quando o app nativo registra seu token, removemos os tokens de push
-- WEB-MOBILE do próprio usuário (mantendo o token nativo e os tokens de DESKTOP).
-- Assim o celular passa a receber só a notificação nativa, que abre o app.
--
-- IDEMPOTENTE. COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

CREATE OR REPLACE FUNCTION prune_mobile_web_tokens()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;

  DELETE FROM user_fcm_tokens
  WHERE user_id = auth.uid()
    AND device_info IS NOT NULL
    -- nunca remove o token NATIVO (device_info "Android/Native/...")
    AND device_info NOT ILIKE '%native%'
    -- alvos: tokens de navegador MÓVEL (marcador novo ou plataformas móveis)
    AND (
      device_info ILIKE 'WebMobile/%'
      OR device_info ILIKE '%android%'
      OR device_info ILIKE '%arm%'
      OR device_info ILIKE '%aarch64%'
      OR device_info ILIKE '%iphone%'
      OR device_info ILIKE '%ipad%'
    );

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION prune_mobile_web_tokens() TO authenticated;

-- TESTE: SELECT prune_mobile_web_tokens();  (rodar logado; retorna nº removidos)
-- ============================================================================
