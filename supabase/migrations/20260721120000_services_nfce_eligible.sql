-- Permite marcar um serviço do catálogo para ser emitido junto em NFC-e/NF-e
-- como se fosse produto (ex.: "Taxa de serviço" 10%). Quando habilitado, o
-- serviço passa a valer também na emissão de produtos, usando o NCM/CFOP abaixo.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS nfce_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfce_ncm  text,
  ADD COLUMN IF NOT EXISTS nfce_cfop text DEFAULT '5102';
