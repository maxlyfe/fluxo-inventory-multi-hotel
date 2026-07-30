-- Guarda o identificador da DPS enviada à Plataforma Nacional.
--
-- Motivo: a API Nacional pode aceitar a DPS e devolver a NFS-e como
-- "<em processamento adn nacional>", sem número, chave nem código de
-- verificação. O emissor faz alguns polls curtos na hora, mas se o
-- processamento nacional demorar mais que isso a nota fica gravada sem os dados
-- de autorização e sem nenhuma forma de buscá-los depois: o endpoint de
-- reconsulta é GET nfseDps/{idDPS}, e o idDPS não era guardado em lugar nenhum.
--
-- Formato: DPS + cLocEmi(7) + tpInsc(1) + CNPJ(14) + serie(5) + numero(15).

ALTER TABLE nf_invoices
  ADD COLUMN IF NOT EXISTS id_dps text;

COMMENT ON COLUMN nf_invoices.id_dps IS
  'Identificador da DPS na Plataforma Nacional (NFS-e). Usado para reconsultar a NFS-e quando a autorizacao nacional nao chega na hora da emissao.';

CREATE INDEX IF NOT EXISTS nf_invoices_id_dps_pendente_idx
  ON nf_invoices (hotel_id)
  WHERE id_dps IS NOT NULL AND chave_acesso IS NULL;
