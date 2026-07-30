-- Separa o codigo de servico municipal usado pela NFS-e Nacional (DPS, tag
-- <cIntContrib>) do campo usado pela NFS-e via Prefeitura (SOAP ABRASF, tag
-- <CodigoTributacaoMunicipio>).
--
-- Ate aqui os dois provedores liam/escreviam a MESMA coluna
-- (nf_hotel_config.codigo_servico_municipal), mas com formatos exigidos
-- diferentes: o SOAP ABRASF valida o valor contra a tabela oficial do
-- municipio e exige o formato "9.01" com ponto (E35 = codigo de tributacao
-- inexistente se o formato nao bater); a DPS Nacional so remove caracteres
-- nao alfanumericos do valor e usa o resultado como "codigo interno do
-- contribuinte" (cIntContrib), sem validar contra a tabela oficial.
--
-- Caso real (30/07/2026): Costa do Sol emitiu NFS-e Nacional as 12h com o
-- campo compartilhado em "9,01", trocou o formato de emissao para
-- Prefeitura (ABRASF) na mesma tela e a proxima emissao (Day Use) rejeitou
-- com E35 porque o SOAP exige o valor com ponto. Editar uma aba
-- sobrescrevia o valor usado pela outra.

ALTER TABLE nf_hotel_config
  ADD COLUMN IF NOT EXISTS nfse_cint_contrib text;

COMMENT ON COLUMN nf_hotel_config.nfse_cint_contrib IS
  'Codigo interno do contribuinte (cIntContrib) da DPS da NFS-e Nacional (provedor el-nacional). Independente de codigo_servico_municipal, que e exclusivo do SOAP ABRASF (CodigoTributacaoMunicipio, exige ponto, ex. 9.01).';

COMMENT ON COLUMN nf_hotel_config.codigo_servico_municipal IS
  'CodigoTributacaoMunicipio do SOAP ABRASF (prefeitura) -- valor da tabela oficial do municipio, com ponto (ex. 9.01). Nao usar para a DPS Nacional: ver nfse_cint_contrib.';

-- Preserva continuidade: copia o valor atual como ponto de partida para
-- quem ainda nao tiver o campo novo preenchido.
UPDATE nf_hotel_config
   SET nfse_cint_contrib = codigo_servico_municipal
 WHERE nfse_cint_contrib IS NULL;
