-- Reforma Tributária (NT 2025.002 v1.40) — liga o grupo IBS/CBS na NFC-e/NF-e
-- por hotel, substituindo a env var global NFCE_IBSCBS como chave de ativação.
--
-- Contexto:
--   · A NT 2025.002 v1.40 (20/05/2026) fixou produção OBRIGATÓRIA em 03/08/2026
--     para emitentes de regime normal (CRT=3). Sem os grupos IBSCBS (item) e
--     IBSCBSTot (total) a nota passa a ser rejeitada.
--   · Simples Nacional/MEI (CRT=1/2/4) só entram em Jan/2027 — o builder já
--     devolve o grupo vazio para esses CRTs, então ligar a flag neles é inócuo.
--   · A ativação fica por hotel (e não por env var) para permitir desligar na
--     hora, pela tela /admin/nf-integration, se a SEFAZ rejeitar — sem depender
--     de redeploy da Netlify. O kill switch global continua existindo em
--     nfce-sefaz.ts: NFCE_IBSCBS=0 desliga todos, NFCE_IBSCBS=1 liga todos.

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfce_ibs_cbs_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN nf_hotel_config.nfce_ibs_cbs_enabled IS
  'Emite os grupos IBSCBS/IBSCBSTot da Reforma Tributaria (NT 2025.002) na NFC-e e NF-e. Obrigatorio para CRT=3 desde 03/08/2026; ignorado para CRT 1/2/4 (Simples/MEI, prazo Jan/2027).';

-- Ativa para quem é obrigado hoje (regime normal). Idempotente.
UPDATE nf_hotel_config
   SET nfce_ibs_cbs_enabled = true
 WHERE crt = 3
   AND nfce_ibs_cbs_enabled IS DISTINCT FROM true;
