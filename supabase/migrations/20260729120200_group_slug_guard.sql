-- ============================================================================
-- Anti-enumeração de grupos: 5 slugs inexistentes + 30s de espera (por IP)
-- ============================================================================
-- O campo do modal da landing não é senha — é o slug público do grupo, que é
-- derivado do nome e portanto adivinhável. Sem limite, dá para varrer a lista
-- inteira de clientes ativos.
--
-- O rate limit vive DENTRO da própria get_group_by_slug, que é a única porta
-- para essa informação. Não há caminho alternativo: é inburlável por
-- construção, sem depender de Edge Function nem de código no front.
--
-- A assinatura não muda — os três consumidores existentes (GroupLogin,
-- AppGroupGate, WCIGroupGate) continuam funcionando sem alteração.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── Estado do bloqueio por IP ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.slug_lookup_lockouts (
  ip            TEXT        PRIMARY KEY,
  fail_count    INT         NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fail_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slug_lookup_lockouts_last_fail
  ON public.slug_lookup_lockouts (last_fail_at);

ALTER TABLE public.slug_lookup_lockouts ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy: a tabela só é tocada pela função SECURITY DEFINER abaixo.
REVOKE ALL ON public.slug_lookup_lockouts FROM anon, authenticated, PUBLIC;

-- ============================================================================
-- get_group_by_slug com guarda
-- ============================================================================
-- Mudanças em relação a 20260610120000_group_login.sql:
--   * LANGUAGE sql STABLE → plpgsql VOLATILE (precisa gravar o contador).
--     supabase.rpc() já usa POST, então nada quebra no cliente.
--   * Só conta falha quando o slug NÃO existe — slug válido jamais penaliza
--     um usuário legítimo.
--   * Bloqueado → responde HTTP 429 com corpo vazio, que o supabase-js
--     entrega ao front como erro tratável.
--
-- Parâmetros: 5 falhas em 30s → 30s de bloqueio.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_group_by_slug(p_slug TEXT)
RETURNS TABLE(id UUID, name TEXT, slug TEXT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  MAX_FAILS   CONSTANT INT      := 5;
  BLOCK_FOR   CONSTANT INTERVAL := INTERVAL '30 seconds';
  WINDOW_SPAN CONSTANT INTERVAL := INTERVAL '30 seconds';

  v_ip      TEXT;
  v_blocked TIMESTAMPTZ;
  v_found   BOOLEAN := false;
BEGIN
  -- IP do chamador via header do PostgREST (pode não existir em chamadas locais)
  BEGIN
    v_ip := split_part(
      COALESCE(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  v_ip := NULLIF(trim(COALESCE(v_ip, '')), '');

  -- Sem IP identificável (Edge Function com service_role, SQL Editor, jobs
  -- internos) não há o que limitar: todos cairiam no MESMO balde e cinco
  -- slugs inválidos derrubariam o login de todo mundo. Requisição vinda da
  -- internet via PostgREST sempre traz x-forwarded-for.
  IF v_ip IS NULL THEN
    RETURN QUERY
      SELECT g.id, g.name, g.slug
        FROM public.groups g
       WHERE lower(g.slug) = lower(p_slug)
         AND COALESCE(g.is_active, true) = true
       LIMIT 1;
    RETURN;
  END IF;

  -- Já bloqueado? Responde 429 sem tocar na tabela `groups`.
  SELECT s.blocked_until INTO v_blocked
    FROM public.slug_lookup_lockouts s
   WHERE s.ip = v_ip;

  IF v_blocked IS NOT NULL AND v_blocked > now() THEN
    PERFORM set_config('response.status', '429', true);
    RETURN;
  END IF;

  -- Resolve o grupo
  RETURN QUERY
    SELECT g.id, g.name, g.slug
      FROM public.groups g
     WHERE lower(g.slug) = lower(p_slug)
       AND COALESCE(g.is_active, true) = true
     LIMIT 1;

  v_found := FOUND;

  IF v_found THEN
    -- Acerto limpa o histórico daquele IP
    DELETE FROM public.slug_lookup_lockouts s WHERE s.ip = v_ip;
    RETURN;
  END IF;

  -- Slug inexistente: contabiliza a falha
  INSERT INTO public.slug_lookup_lockouts AS sl (ip, fail_count, window_start, last_fail_at)
  VALUES (v_ip, 1, now(), now())
  ON CONFLICT (ip) DO UPDATE
    SET fail_count = CASE
          WHEN sl.window_start < now() - WINDOW_SPAN THEN 1
          ELSE sl.fail_count + 1
        END,
        window_start = CASE
          WHEN sl.window_start < now() - WINDOW_SPAN THEN now()
          ELSE sl.window_start
        END,
        last_fail_at = now();

  UPDATE public.slug_lookup_lockouts s
     SET blocked_until = now() + BLOCK_FOR,
         fail_count    = 0,
         window_start  = now()
   WHERE s.ip = v_ip
     AND s.fail_count >= MAX_FAILS;

  -- Se esta foi a falha que estourou o limite, já devolve 429
  IF FOUND THEN
    PERFORM set_config('response.status', '429', true);
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_by_slug(TEXT) TO anon, authenticated;

-- ── Limpeza de linhas antigas (opcional) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.slug_lookup_cleanup()
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_deleted INT;
BEGIN
  DELETE FROM public.slug_lookup_lockouts
   WHERE last_fail_at < now() - INTERVAL '1 day'
     AND (blocked_until IS NULL OR blocked_until < now());
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.slug_lookup_cleanup() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.slug_lookup_cleanup() TO service_role;

-- Conferir:
--   SELECT * FROM get_group_by_slug('meridiana');       -- existe → 1 linha
--   SELECT * FROM get_group_by_slug('nao-existe-xyz');  -- na 5ª falha já vem 429
--   SELECT * FROM slug_lookup_lockouts;
-- ============================================================================
