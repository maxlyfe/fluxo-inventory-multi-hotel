-- Toggle por hotel: a taxa de serviço (acréscimo/vOutro) entra ou não na base
-- do ICMS na NFC-e. false (padrão) = fora da base; true = dentro da base.
ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfce_taxa_na_base_icms boolean NOT NULL DEFAULT false;
