-- ============================================================================
-- Login guard: bloqueio por tentativas de senha (3 falhas + 30s)
-- ============================================================================
-- O lockout vive no BANCO, não no front. Quem aplica é a Edge Function
-- `auth-login`, que roda com service_role e é o único caminho de login por
-- senha do app. O front não consegue burlar porque não enxerga nem a tabela
-- nem as funções (EXECUTE revogado de anon/authenticated).
--
-- IMPORTANTE: sozinho, isto protege apenas o caminho da UI. O endpoint
-- /auth/v1/token do Supabase continua público. Quem fecha esse bypass é o
-- CAPTCHA (Turnstile) habilitado em Authentication → Attack Protection.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── Estado do bloqueio (não é log: uma linha por chave) ─────────────────────
CREATE TABLE IF NOT EXISTS public.login_lockouts (
  scope         TEXT        NOT NULL,   -- 'user' (e-mail normalizado) | 'ip'
  key           TEXT        NOT NULL,
  fail_count    INT         NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fail_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until TIMESTAMPTZ,
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_login_lockouts_last_fail
  ON public.login_lockouts (last_fail_at);

ALTER TABLE public.login_lockouts ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy: só o service_role (que ignora RLS) enxerga.
REVOKE ALL ON public.login_lockouts FROM anon, authenticated, PUBLIC;

-- ============================================================================
-- Parâmetros — ajuste aqui para endurecer/afrouxar
-- ============================================================================
--   USER: 3 falhas  → 30s de bloqueio   (o que foi pedido)
--   IP:  10 falhas  → 60s de bloqueio   (freia varredura de vários usuários)
--   WINDOW: 15 min — falhas mais antigas que isso não contam mais
--
-- Nota: 3 falhas + 30s permite ~360 senhas/hora por conta indefinidamente.
-- Para endurecer, uma opção é multiplicar o bloqueio a cada lockout
-- consecutivo (30s → 2min → 10min) em vez de zerar fail_count no bloqueio.
-- ============================================================================

-- ── Consulta: a tentativa pode prosseguir? ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.login_guard_check(p_email TEXT, p_ip TEXT)
RETURNS TABLE(allowed BOOLEAN, retry_after INT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_ip    TEXT := COALESCE(NULLIF(trim(COALESCE(p_ip, '')), ''), 'unknown');
  v_wait  INT  := 0;
BEGIN
  SELECT COALESCE(MAX(CEIL(EXTRACT(EPOCH FROM (l.blocked_until - now()))))::INT, 0)
    INTO v_wait
    FROM public.login_lockouts l
   WHERE l.blocked_until IS NOT NULL
     AND l.blocked_until > now()
     AND ((l.scope = 'user' AND l.key = v_email) OR (l.scope = 'ip' AND l.key = v_ip));

  IF v_wait > 0 THEN
    RETURN QUERY SELECT false, GREATEST(v_wait, 1);
  ELSE
    RETURN QUERY SELECT true, 0;
  END IF;
END;
$$;

-- ── Registra uma falha; devolve os segundos de bloqueio (0 = ainda liberado) ─
CREATE OR REPLACE FUNCTION public.login_guard_fail(p_email TEXT, p_ip TEXT)
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  MAX_FAILS_USER CONSTANT INT      := 3;
  BLOCK_USER     CONSTANT INTERVAL := INTERVAL '30 seconds';
  MAX_FAILS_IP   CONSTANT INT      := 10;
  BLOCK_IP       CONSTANT INTERVAL := INTERVAL '60 seconds';
  WINDOW_SPAN    CONSTANT INTERVAL := INTERVAL '15 minutes';

  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_ip    TEXT := COALESCE(NULLIF(trim(COALESCE(p_ip, '')), ''), 'unknown');
  v_block INT  := 0;
  r       RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('user', v_email, MAX_FAILS_USER, BLOCK_USER),
      ('ip',   v_ip,    MAX_FAILS_IP,   BLOCK_IP)
    ) AS t(scope, key, max_fails, block_for)
  LOOP
    CONTINUE WHEN r.key IS NULL OR r.key = '';

    INSERT INTO public.login_lockouts AS ll (scope, key, fail_count, window_start, last_fail_at)
    VALUES (r.scope, r.key, 1, now(), now())
    ON CONFLICT (scope, key) DO UPDATE
      SET fail_count = CASE
            WHEN ll.window_start < now() - WINDOW_SPAN THEN 1
            ELSE ll.fail_count + 1
          END,
          window_start = CASE
            WHEN ll.window_start < now() - WINDOW_SPAN THEN now()
            ELSE ll.window_start
          END,
          last_fail_at = now();

    -- Atingiu o limite → bloqueia e reinicia a janela
    UPDATE public.login_lockouts l
       SET blocked_until = now() + r.block_for,
           fail_count    = 0,
           window_start  = now()
     WHERE l.scope = r.scope
       AND l.key   = r.key
       AND l.fail_count >= r.max_fails;

    IF FOUND THEN
      v_block := GREATEST(v_block, CEIL(EXTRACT(EPOCH FROM r.block_for))::INT);
    END IF;
  END LOOP;

  RETURN v_block;
END;
$$;

-- ── Login bem-sucedido: limpa o histórico das duas chaves ───────────────────
CREATE OR REPLACE FUNCTION public.login_guard_reset(p_email TEXT, p_ip TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_ip    TEXT := COALESCE(NULLIF(trim(COALESCE(p_ip, '')), ''), 'unknown');
BEGIN
  DELETE FROM public.login_lockouts l
   WHERE (l.scope = 'user' AND l.key = v_email)
      OR (l.scope = 'ip'   AND l.key = v_ip);
END;
$$;

-- ── Limpeza de linhas antigas (chamar de tempos em tempos, opcional) ────────
CREATE OR REPLACE FUNCTION public.login_guard_cleanup()
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_deleted INT;
BEGIN
  DELETE FROM public.login_lockouts
   WHERE last_fail_at < now() - INTERVAL '1 day'
     AND (blocked_until IS NULL OR blocked_until < now());
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ── Permissões: só a Edge Function (service_role) pode chamar ───────────────
REVOKE EXECUTE ON FUNCTION public.login_guard_check(TEXT, TEXT)  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.login_guard_fail(TEXT, TEXT)   FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.login_guard_reset(TEXT, TEXT)  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.login_guard_cleanup()          FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.login_guard_check(TEXT, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.login_guard_fail(TEXT, TEXT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.login_guard_reset(TEXT, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION public.login_guard_cleanup()          TO service_role;

-- Conferir:
--   SELECT * FROM login_guard_check('alguem@exemplo.com', '1.2.3.4');
--   SELECT login_guard_fail('alguem@exemplo.com', '1.2.3.4');  -- 3x → 30
--   SELECT * FROM login_lockouts;
-- ============================================================================
