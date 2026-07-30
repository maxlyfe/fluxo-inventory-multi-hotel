-- Endereço estruturado do tomador em nf_invoices.
--
-- Motivo: a DPS da NFS-e Nacional exige o endereço do tomador em campos
-- separados, com <endNac><cMun> (código IBGE de 7 dígitos) e <CEP>. A rejeição
-- E0234 ("o endereço do tomador é obrigatório para o indicador de operação
-- informado") aparece justamente quando esse bloco não vai na DPS.
--
-- Até aqui a tabela só tinha `tomador_endereco`, um texto livre montado pela
-- tela ("Rua X, 100, Bairro, Cidade / UF, CEP 00000-000"). O usuário preenchia
-- os campos separados no formulário, mas eles eram concatenados e as partes se
-- perdiam — não havia como montar <endNac>, e muito menos o código IBGE, que a
-- tela nem capturava.
--
-- `tomador_endereco` continua existindo e sendo preenchido: é o texto usado nas
-- telas de listagem e no PDF. As colunas novas são a fonte para o XML.

ALTER TABLE nf_invoices
  ADD COLUMN IF NOT EXISTS tomador_logradouro       text,
  ADD COLUMN IF NOT EXISTS tomador_numero           text,
  ADD COLUMN IF NOT EXISTS tomador_complemento      text,
  ADD COLUMN IF NOT EXISTS tomador_bairro           text,
  ADD COLUMN IF NOT EXISTS tomador_cidade           text,
  ADD COLUMN IF NOT EXISTS tomador_uf               text,
  ADD COLUMN IF NOT EXISTS tomador_cep              text,
  ADD COLUMN IF NOT EXISTS tomador_codigo_municipio text;

COMMENT ON COLUMN nf_invoices.tomador_codigo_municipio IS
  'Codigo IBGE de 7 digitos do municipio do tomador, usado em <endNac><cMun> da DPS. Preenchido pela consulta de CEP (ViaCEP devolve o campo ibge). Precisa ser coerente com o CEP, senao a rejeicao e E0240.';
