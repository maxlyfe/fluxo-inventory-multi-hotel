-- Reforma Tributária (EC 132/2023 · NT 2025.002): campos de IBS/CBS no cadastro
-- de produtos e serviços. Capturados desde já com valor padrão, para estarem
-- prontos quando a emissão com IBS/CBS virar obrigatória.
--
-- Campos (comuns a bens e serviços no layout da reforma):
--   ibs_cbs_cst        — CST do IBS/CBS (3 díg). '000' = tributação integral
--   ibs_cbs_cclasstrib — Código de Classificação Tributária (6 díg). '000001'
--                        = tributação integral (padrão geral)
--
-- Os valores monetários (vBC, vIBS, vCBS) NÃO ficam no cadastro — são calculados
-- na emissão a partir do preço e das alíquotas vigentes.
--
-- ADD COLUMN ... DEFAULT já preenche todas as linhas existentes com o padrão.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ibs_cbs_cst        text DEFAULT '000',
  ADD COLUMN IF NOT EXISTS ibs_cbs_cclasstrib text DEFAULT '000001';

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS ibs_cbs_cst        text DEFAULT '000',
  ADD COLUMN IF NOT EXISTS ibs_cbs_cclasstrib text DEFAULT '000001';

-- Garante que registros já existentes que porventura tenham NULL recebam o padrão.
UPDATE products SET ibs_cbs_cst = COALESCE(ibs_cbs_cst, '000'),
                    ibs_cbs_cclasstrib = COALESCE(ibs_cbs_cclasstrib, '000001');
UPDATE services SET ibs_cbs_cst = COALESCE(ibs_cbs_cst, '000'),
                    ibs_cbs_cclasstrib = COALESCE(ibs_cbs_cclasstrib, '000001');
