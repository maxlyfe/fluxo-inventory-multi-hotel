-- ============================================================================
-- Reenvio manual da ficha de web check-in para a Erbon (por hospede)
-- ============================================================================
-- Motivo: o envio para a Erbon no fluxo do hospede e best-effort (nunca pode
-- bloquear o check-in). Quando a Erbon esta fora do ar, recusa credencial ou
-- rejeita o payload, o dado fica so no LyFe e a recepcao nao tinha como
-- reenviar: era preciso refazer o check-in ou digitar tudo no PMS.
--
-- Solucao: /reception/wci-fichas ganha um botao de reenvio por hospede, que
-- repete cadastro + documentos + termo assinado. O resultado do ultimo envio
-- fica gravado na propria linha do hospede, para a recepcao ver o que falhou.
--
-- ATENCAO: wci_checkin_fichas e wci_checkin_guests foram criadas fora do
-- versionamento (SQL Editor). Por isso tudo aqui e IF NOT EXISTS / OR REPLACE.
--
-- COMO USAR: Supabase Dashboard -> SQL Editor -> cole e rode.
-- ============================================================================

-- ── Estado do ultimo envio, por hospede ─────────────────────────────────────

ALTER TABLE public.wci_checkin_guests
  ADD COLUMN IF NOT EXISTS erbon_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS erbon_sync_error text;

COMMENT ON COLUMN public.wci_checkin_guests.erbon_synced_at IS
  'Quando o cadastro deste hospede foi aceito pela Erbon pela ultima vez. NULL = nunca sincronizou (ou ficha anterior a 09/09/2026).';

COMMENT ON COLUMN public.wci_checkin_guests.erbon_sync_error IS
  'Resumo da falha do ultimo reenvio para a Erbon. NULL quando o ultimo envio foi integralmente aceito.';

-- ── Marcacao do resultado do reenvio ────────────────────────────────────────
-- Vai por RPC SECURITY DEFINER porque o UPDATE direto depende das policies de
-- wci_checkin_guests (tabela criada fora do versionamento). O acesso e gatilhado
-- pelo hotel da ficha via can_read_hotel(), o mesmo predicado das demais tabelas
-- multi-tenant. Tambem devolve para o banco o id do hospede na Erbon quando o
-- reenvio criou um cadastro novo, para o proximo reenvio atualizar em vez de
-- duplicar.

CREATE OR REPLACE FUNCTION public.wci_mark_guest_erbon_sync(
  p_guest_id        uuid,
  p_ok              boolean,
  p_erbon_guest_id  bigint DEFAULT NULL,
  p_error           text   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel_id uuid;
BEGIN
  SELECT f.hotel_id
    INTO v_hotel_id
    FROM public.wci_checkin_guests g
    JOIN public.wci_checkin_fichas f ON f.id = g.ficha_id
   WHERE g.id = p_guest_id
   LIMIT 1;

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'wci: hospede nao encontrado';
  END IF;

  IF NOT public.can_read_hotel(v_hotel_id) THEN
    RAISE EXCEPTION 'wci: sem acesso a este hotel';
  END IF;

  UPDATE public.wci_checkin_guests g
     SET erbon_guest_id   = COALESCE(NULLIF(p_erbon_guest_id, 0), g.erbon_guest_id),
         erbon_synced_at  = CASE WHEN p_ok THEN now() ELSE g.erbon_synced_at END,
         erbon_sync_error = CASE WHEN p_ok THEN NULL ELSE p_error END
   WHERE g.id = p_guest_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wci_mark_guest_erbon_sync(uuid, boolean, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wci_mark_guest_erbon_sync(uuid, boolean, bigint, text)
  TO authenticated;

-- Conferir:
--   SELECT name, erbon_guest_id, erbon_synced_at, erbon_sync_error
--     FROM wci_checkin_guests ORDER BY id DESC LIMIT 10;
-- ============================================================================
