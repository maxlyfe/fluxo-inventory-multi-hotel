# Schemas oficiais da NFS-e Nacional (leiaute 1.01)

Schemas XSD do padrão nacional (namespace `http://www.sped.fazenda.gov.br/nfse`), usados por
`netlify/functions/lib/el-nacional-nfse.ts` (E&L Búzios) e `adn-nfse.ts` (Sefin Nacional).

Estão aqui porque a DPS já foi recusada seis vezes por detalhe de schema (`E1235`), e inferir
estrutura de PDF de terceiros custou várias emissões em produção. Antes de mexer no XML da DPS,
confira o tipo aqui: ordem do `sequence`, `choice`, `minOccurs` e pattern são o que o validador
do fisco cobra, e ele valida antes de qualquer regra de negócio.

| Arquivo | Conteúdo |
|---|---|
| `DPS_v1.01.xsd` | Raiz `<DPS>` (tipo `TCDPS`) |
| `tiposComplexos_v1.01.xsd` | Todos os tipos complexos: `TCInfDPS`, `TCInfoPessoa`, `TCEndereco`, `TCServ`, `TCLocPrest`, `TCComExterior`, `TCRTCInfoIBSCBS` (IBS/CBS) etc. |

## Pontos que já geraram rejeição

- **`TCLocPrest` é `xs:choice`**: ou `cLocPrestacao` (município IBGE) ou `cPaisPrestacao` (país
  ISO alfa-2, pattern `[A-Z]{2}`). Nunca os dois. Serviço no Brasil vai pelo município.
- **`TCServ` é `sequence`**: `locPrest`, `cServ`, `comExt`, `obra`, `atvEvento`, `infoCompl`.
  Fora dessa ordem é `E1235`.
- **`TCComExterior`**: opcional, mas quando existe todos os filhos são obrigatórios, exceto
  `nDI` e `nRE`. É o grupo que declara tomador do exterior (`mdPrestacao=2`, consumo no Brasil).
- **`TCInfoPessoa`**: identificação é `choice` entre `CNPJ`, `CPF`, `NIF` e `cNaoNIF`;
  `end` é opcional, e dentro dele `endNac`/`endExt` também é `choice`.
- **`TCEnderExt`** exige `cPais`, `cEndPost`, `xCidade` e `xEstProvReg` juntos: só dá para
  informar endereço no exterior quando existem os quatro dados.

## Falta aqui

`tiposSimples_v1.01.xsd` (os `xs:simpleType` com as enumerações e patterns: `TSCodPaisISO`,
`TSRTCIndDest`, `TSRTCCodIndOp`, `TSCodMoeda`...). O pacote recebido trouxe os arquivos com
nomes trocados e essa parte não veio. Enquanto não vier, as enumerações saem do Manual de
Integração v1.01 (as usadas estão documentadas nos comentários do builder da DPS).
