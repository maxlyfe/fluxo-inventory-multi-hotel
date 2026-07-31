-- ============================================================================
-- Ficha de web check-in individual + endereço estruturado
-- ============================================================================
-- Motivo: o endereço do tomador chegava sempre vazio em /finances/emissao-nf.
-- Quatro causas no lado do web check-in:
--
--   1. A ficha só era gravada no passo final (assinatura). Quem preenchia o
--      FNRH e saía antes de assinar não deixava linha em wci_checkin_guests.
--   2. No fluxo mobile, cada acompanhante criava uma ficha NOVA contendo ele
--      mesmo completo mais cópias dos outros hóspedes, quase sempre sem
--      endereço. A busca do tomador (nfService.lookupWCIGuest) acabava
--      devolvendo uma dessas cópias vazias.
--   3. O INSERT nunca escrevia `status`, e a busca filtrava status='completed'.
--      O valor dependia do default da coluna, então o filtro podia nunca casar.
--   4. Não existia número, complemento nem código IBGE do município. A NFC-e
--      exige <nro> e a DPS da NFS-e Nacional exige <endNac><cMun>; o job do
--      FNRH Gov mandava numero/complemento/cidade_id literalmente vazios.
--
-- Solução: a ficha passa a ser de UMA pessoa (assinatura e aceite de termos já
-- eram individuais na tabela) e é gravada assim que o hóspede conclui o
-- preenchimento, via RPC. A chave de identificação é `guest_key`.
--
-- Compatibilidade: fichas antigas ficam com guest_key NULL e continuam sendo
-- lidas normalmente por WCIFichasView, FNRHPrintModal e fnrh-daily-sync. Nada
-- é migrado nem apagado.
--
-- ATENÇÃO: wci_checkin_fichas, wci_checkin_guests e wci_sessions foram criadas
-- fora do versionamento (SQL Editor). Por isso tudo aqui é IF NOT EXISTS.
--
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode.
-- ============================================================================

-- ── Colunas novas ───────────────────────────────────────────────────────────

ALTER TABLE public.wci_checkin_guests
  ADD COLUMN IF NOT EXISTS address_number     text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS address_city_ibge  text,
  ADD COLUMN IF NOT EXISTS profession         text,
  ADD COLUMN IF NOT EXISTS vehicle_registration text;

COMMENT ON COLUMN public.wci_checkin_guests.address_number IS
  'Numero do endereco, capturado em campo proprio no formulario. Vai em <nro> da NFC-e/NFS-e e no campo numero do FNRH Gov. Antes ficava embutido no texto de address_street.';

COMMENT ON COLUMN public.wci_checkin_guests.address_city_ibge IS
  'Codigo IBGE de 7 digitos do municipio, vindo do campo ibge do ViaCEP. Alimenta <endNac><cMun> da DPS da NFS-e Nacional e cidade_id do FNRH Gov. Precisa ser coerente com o CEP, senao a rejeicao e E0240.';

ALTER TABLE public.wci_checkin_fichas
  ADD COLUMN IF NOT EXISTS guest_key  text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN public.wci_checkin_fichas.guest_key IS
  'Identidade do hospede dentro da reserva: o erbon_guest_id quando existe, senao name: mais o nome normalizado. Chave do upsert de wci_upsert_guest_ficha. NULL nas fichas legadas (agrupadas por reserva).';

CREATE INDEX IF NOT EXISTS idx_wci_checkin_fichas_guest_lookup
  ON public.wci_checkin_fichas (hotel_id, booking_number, guest_key);

-- ── Normalização do nome (base do guest_key quando não há id na Erbon) ──────
-- Sem unaccent de propósito: a extensão pode não estar instalada e o nome é
-- comparado sempre contra outra ficha gerada por esta mesma função.

CREATE OR REPLACE FUNCTION public.wci_normalize_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g'));
$$;

-- ── Upsert da ficha de um hóspede ───────────────────────────────────────────
-- Autenticada pelo session_token, que já é o segredo do fluxo público. O
-- hotel_id e o booking_number vêm SEMPRE da sessão, nunca do cliente, para que
-- um token não consiga escrever ficha em outra reserva ou outro hotel.
--
-- Por que RPC e não UPDATE direto: o web check-in escreve com a chave anon.
-- Liberar UPDATE anônimo em wci_checkin_fichas permitiria adulterar a ficha de
-- qualquer hóspede da rede.

CREATE OR REPLACE FUNCTION public.wci_upsert_guest_ficha(
  p_session_token text,
  p_guest          jsonb,
  p_room_number    text DEFAULT NULL,
  p_checkin_date   date DEFAULT NULL,
  p_checkout_date  date DEFAULT NULL,
  p_source         text DEFAULT 'web'
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel_id       uuid;
  v_booking_number text;
  v_booking_int    bigint;
  v_erbon_guest_id bigint;
  v_name           text;
  v_guest_key      text;
  v_ficha_id       uuid;
BEGIN
  IF p_session_token IS NULL OR length(trim(p_session_token)) = 0 THEN
    RAISE EXCEPTION 'wci: sessao nao informada';
  END IF;

  SELECT s.hotel_id,
         s.booking_number,
         NULLIF(regexp_replace(COALESCE(s.booking_id, ''), '\D', '', 'g'), '')::bigint
    INTO v_hotel_id, v_booking_number, v_booking_int
    FROM public.wci_sessions s
   WHERE s.session_token = p_session_token
   LIMIT 1;

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'wci: sessao invalida ou expirada';
  END IF;

  v_name := trim(COALESCE(p_guest->>'name', ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'wci: nome do hospede obrigatorio';
  END IF;

  v_erbon_guest_id := NULLIF(p_guest->>'erbon_guest_id', '')::bigint;
  IF v_erbon_guest_id IS NOT NULL AND v_erbon_guest_id > 0 THEN
    v_guest_key := 'erbon:' || v_erbon_guest_id::text;
  ELSE
    v_erbon_guest_id := NULL;
    v_guest_key := 'name:' || public.wci_normalize_name(v_name);
  END IF;

  SELECT f.id INTO v_ficha_id
    FROM public.wci_checkin_fichas f
   WHERE f.hotel_id = v_hotel_id
     AND f.booking_number IS NOT DISTINCT FROM v_booking_number
     AND f.guest_key = v_guest_key
   ORDER BY f.created_at DESC
   LIMIT 1;

  IF v_ficha_id IS NULL THEN
    INSERT INTO public.wci_checkin_fichas (
      hotel_id, booking_number, booking_internal_id, guest_key,
      room_number, checkin_date, checkout_date,
      guest_name, hotel_terms_accepted, lgpd_accepted,
      source, status, created_at, updated_at
    ) VALUES (
      v_hotel_id, v_booking_number, v_booking_int, v_guest_key,
      p_room_number, p_checkin_date, p_checkout_date,
      v_name, false, false,
      COALESCE(p_source, 'web'), 'partial', now(), now()
    )
    RETURNING id INTO v_ficha_id;
  ELSE
    UPDATE public.wci_checkin_fichas f
       SET guest_name          = v_name,
           booking_internal_id = COALESCE(v_booking_int, f.booking_internal_id),
           room_number         = COALESCE(p_room_number, f.room_number),
           checkin_date        = COALESCE(p_checkin_date, f.checkin_date),
           checkout_date       = COALESCE(p_checkout_date, f.checkout_date),
           source              = COALESCE(p_source, f.source),
           updated_at          = now()
     WHERE f.id = v_ficha_id;
  END IF;

  -- Uma ficha, um hóspede: a linha é reescrita a cada salvamento.
  DELETE FROM public.wci_checkin_guests g WHERE g.ficha_id = v_ficha_id;

  INSERT INTO public.wci_checkin_guests (
    ficha_id, is_main_guest, erbon_guest_id,
    name, email, phone, birth_date, gender_id, nationality,
    profession, vehicle_registration,
    document_type, document_number, document_expiration,
    address_country, address_state, address_city, address_street,
    address_number, address_complement, address_neighborhood,
    address_zipcode, address_city_ibge,
    document_front_url, document_back_url,
    fnrh_raca_id, fnrh_deficiencia_id, fnrh_tipo_deficiencia_id,
    fnrh_motivo_viagem_id, fnrh_meio_transporte_id,
    fnrh_grau_parentesco_id, fnrh_responsavel_documento, fnrh_responsavel_doc_tipo
  ) VALUES (
    v_ficha_id,
    COALESCE((p_guest->>'is_main_guest')::boolean, false),
    v_erbon_guest_id,
    v_name,
    NULLIF(p_guest->>'email', ''),
    NULLIF(p_guest->>'phone', ''),
    NULLIF(p_guest->>'birth_date', '')::date,
    NULLIF(p_guest->>'gender_id', '')::int,
    NULLIF(p_guest->>'nationality', ''),
    NULLIF(p_guest->>'profession', ''),
    NULLIF(p_guest->>'vehicle_registration', ''),
    NULLIF(p_guest->>'document_type', ''),
    NULLIF(p_guest->>'document_number', ''),
    NULLIF(p_guest->>'document_expiration', '')::date,
    NULLIF(p_guest->>'address_country', ''),
    NULLIF(p_guest->>'address_state', ''),
    NULLIF(p_guest->>'address_city', ''),
    NULLIF(p_guest->>'address_street', ''),
    NULLIF(p_guest->>'address_number', ''),
    NULLIF(p_guest->>'address_complement', ''),
    NULLIF(p_guest->>'address_neighborhood', ''),
    NULLIF(p_guest->>'address_zipcode', ''),
    NULLIF(p_guest->>'address_city_ibge', ''),
    NULLIF(p_guest->>'document_front_url', ''),
    NULLIF(p_guest->>'document_back_url', ''),
    NULLIF(p_guest->>'fnrh_raca_id', ''),
    NULLIF(p_guest->>'fnrh_deficiencia_id', ''),
    NULLIF(p_guest->>'fnrh_tipo_deficiencia_id', ''),
    NULLIF(p_guest->>'fnrh_motivo_viagem_id', ''),
    NULLIF(p_guest->>'fnrh_meio_transporte_id', ''),
    NULLIF(p_guest->>'fnrh_grau_parentesco_id', ''),
    NULLIF(p_guest->>'fnrh_responsavel_documento', ''),
    NULLIF(p_guest->>'fnrh_responsavel_doc_tipo', '')
  );

  RETURN v_ficha_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wci_upsert_guest_ficha(text, jsonb, text, date, date, text)
  TO anon, authenticated;

-- ── Finalização (assinatura + termos) ───────────────────────────────────────
-- p_guest_key NULL finaliza TODAS as fichas da reserva daquela sessão: é o
-- fluxo do totem, onde o titular assina uma vez por todos. O fluxo mobile
-- passa a guest_key da pessoa que está no aparelho.
-- Retorna quantas fichas foram finalizadas, para o front saber se havia ficha.

CREATE OR REPLACE FUNCTION public.wci_finalize_ficha(
  p_session_token        text,
  p_signature            text    DEFAULT NULL,
  p_hotel_terms_accepted boolean DEFAULT false,
  p_lgpd_accepted        boolean DEFAULT false,
  p_hotel_terms_text     text    DEFAULT NULL,
  p_lgpd_terms_text      text    DEFAULT NULL,
  p_hotel_rules_doc_url  text    DEFAULT NULL,
  p_lgpd_doc_url         text    DEFAULT NULL,
  p_guest_key            text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel_id       uuid;
  v_booking_number text;
  v_count          integer;
BEGIN
  SELECT s.hotel_id, s.booking_number
    INTO v_hotel_id, v_booking_number
    FROM public.wci_sessions s
   WHERE s.session_token = p_session_token
   LIMIT 1;

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'wci: sessao invalida ou expirada';
  END IF;

  UPDATE public.wci_checkin_fichas f
     SET status               = 'completed',
         signature_data       = COALESCE(p_signature, f.signature_data),
         hotel_terms_accepted = p_hotel_terms_accepted OR f.hotel_terms_accepted,
         lgpd_accepted        = p_lgpd_accepted OR f.lgpd_accepted,
         hotel_terms_text     = COALESCE(p_hotel_terms_text, f.hotel_terms_text),
         lgpd_terms_text      = COALESCE(p_lgpd_terms_text, f.lgpd_terms_text),
         hotel_rules_doc_url  = COALESCE(p_hotel_rules_doc_url, f.hotel_rules_doc_url),
         lgpd_doc_url         = COALESCE(p_lgpd_doc_url, f.lgpd_doc_url),
         updated_at           = now()
   WHERE f.hotel_id = v_hotel_id
     AND f.booking_number IS NOT DISTINCT FROM v_booking_number
     AND f.guest_key IS NOT NULL
     AND (p_guest_key IS NULL OR f.guest_key = p_guest_key)
     AND COALESCE(f.status, 'partial') <> 'cancelled';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wci_finalize_ficha(text, text, boolean, boolean, text, text, text, text, text)
  TO anon, authenticated;

-- Conferir:
--   SELECT id, guest_name, guest_key, status FROM wci_checkin_fichas
--    WHERE guest_key IS NOT NULL ORDER BY created_at DESC LIMIT 10;
--   SELECT name, address_street, address_number, address_city_ibge
--     FROM wci_checkin_guests ORDER BY id DESC LIMIT 10;
-- ============================================================================
