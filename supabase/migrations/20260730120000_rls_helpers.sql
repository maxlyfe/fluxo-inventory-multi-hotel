-- ============================================================================
-- Lote 0 — Helpers de RLS (ADITIVO, não muda nenhuma policy)
-- ============================================================================
-- Base para os lotes seguintes. Sozinha esta migration NÃO altera acesso a
-- nada: só cria/endurece funções. Pode ser aplicada com segurança antes de
-- decidir as policies.
--
-- Correção de rota importante: as tabelas de domínio deste projeto NÃO têm
-- group_id. A chave de tenancy é hotel_id, e o vínculo com o grupo mora em
-- hotels.group_id / profiles.group_id. Portanto o predicado padrão das policies
-- é can_read_hotel(hotel_id), não "group_id = my_group_id()".
--
-- Perf: em policy, sempre envolva a chamada em SELECT — `(SELECT can_read_hotel(
-- hotel_id))` — para o planner avaliar uma vez por statement em vez de por
-- linha (initplan). Sem isso, tabela grande fica lenta.
--
-- IDEMPOTENTE. Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── 1. is_admin(): mantém o comportamento, fecha o search_path mutável ──────
-- Era SECURITY DEFINER sem SET search_path (achado function_search_path_mutable)
-- e sem STABLE, o que impede o planner de cachear a chamada dentro da policy.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- ── 2. my_group_id(): idem — criada em 20260629120000_internal_chat.sql ─────
CREATE OR REPLACE FUNCTION public.my_group_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── 3. can_read_hotel(hid): o predicado padrão das policies ────────────────
-- Envelopa user_can_access_hotel(auth.uid(), hid) (20260608200000) numa forma
-- de 1 argumento, para as policies ficarem curtas e uniformes.
--
-- DECISÃO DELIBERADA: hotel_id NULL devolve true. Muitas tabelas têm linhas
-- globais/legadas com hotel_id nulo; devolver false aqui esconderia dado que o
-- app hoje mostra. É o ponto a revisar tabela a tabela — depois de backfill do
-- hotel_id, troque para `hid IS NOT NULL AND ...` na tabela que já estiver limpa.
CREATE OR REPLACE FUNCTION public.can_read_hotel(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT hid IS NULL OR public.user_can_access_hotel(auth.uid(), hid);
$$;

-- ── 4. hotel_in_my_group(hid): isolamento só por GRUPO ─────────────────────
-- Mais frouxo que can_read_hotel: ignora user_hotel_access e exige apenas que o
-- hotel seja do mesmo grupo. Serve para tabela que o app lê cruzando hotéis do
-- grupo (relatórios de diretoria, comparativos multi-hotel), onde escopar por
-- acesso individual quebraria a tela mas o isolamento cross-tenant continua.
CREATE OR REPLACE FUNCTION public.hotel_in_my_group(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT hid IS NULL
      OR public.is_dev_user(auth.uid())
      OR EXISTS (
           SELECT 1 FROM public.hotels h
           WHERE h.id = hid AND h.group_id = public.my_group_id()
         );
$$;

-- ── 5. Grants ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_group_id()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_hotel(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.hotel_in_my_group(uuid)  TO authenticated;

-- ============================================================================
-- TESTE (logado como usuário comum, no SQL Editor com o JWT do app):
--   SELECT public.my_group_id();                  -- o grupo do usuário
--   SELECT public.can_read_hotel('<hotel-do-grupo>');    -- true
--   SELECT public.can_read_hotel('<hotel-de-outro-grupo>'); -- false
--   SELECT public.can_read_hotel(NULL);           -- true (linha global)
-- ============================================================================
