-- Taxa de turismo isenta de ISS na NFS-e (prefeitura Búzios / ABRASF).
-- Serviço marcado como isento é somado ao valor da nota, mas EXCLUÍDO da base
-- do ISS via <ValorDeducoes> (modo 'deducao'). O modo por hotel prepara o
-- futuro 'servico_isento' (nota isenta separada).
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS nfse_taxa_isenta boolean NOT NULL DEFAULT false;
ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfse_taxa_turismo_modo text NOT NULL DEFAULT 'deducao';
