-- Código NBS por hotel para a DPS da NFS-e Nacional.
--
-- Motivo: rejeição E0322 ("é obrigatório informar na DPS um item da NBS se for
-- declarada qualquer informação de IBS/CBS"). Ou seja, a partir do momento em
-- que a DPS carrega o bloco <IBSCBS> da Reforma Tributária, o campo <cNBS> do
-- grupo <cServ> passa a ser obrigatório. Ele não existia na configuração.
--
-- Formato: inteiro de 9 dígitos, sem pontos (a NBS é escrita como 1.0303.11.00
-- e vai no XML como 103031100).
--
-- Default 103031100 = NBS 1.0303.11.00, "serviços de hospedagem em quartos ou
-- unidades de hospedagem para visitantes, com serviços diários de faxina". A
-- descrição oficial dessa subposição cobre expressamente "hospedagem de
-- qualquer natureza em hotéis, apart-hotéis, flats, apart-services
-- condominiais, hotéis residência e similares", que é o caso das unidades da
-- rede (item 9.01 da LC 116/2003).
--
-- CONFIRMAR COM O CONTADOR antes de tratar como definitivo, sobretudo para
-- serviços que não sejam a diária em si: NBS é por serviço prestado, e a
-- correlação oficial LC116 x NBS x cIndOp x cClassTrib está no Anexo VIII.

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfse_codigo_nbs text DEFAULT '103031100';

COMMENT ON COLUMN nf_hotel_config.nfse_codigo_nbs IS
  'Codigo NBS (9 digitos, sem pontos) usado em <cServ><cNBS> da DPS Nacional. Obrigatorio quando a DPS leva o bloco IBSCBS (rejeicao E0322). Default 103031100 = NBS 1.0303.11.00, hospedagem em hoteis.';

UPDATE nf_hotel_config
   SET nfse_codigo_nbs = '103031100'
 WHERE nfse_codigo_nbs IS NULL;
