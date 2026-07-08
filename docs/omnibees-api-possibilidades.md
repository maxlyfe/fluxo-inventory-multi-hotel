# Omnibees — O que a API nos permite fazer

**Documento de possibilidades · PMS Omnibees (OTA 2014B, Pull WebService)**
Baseado na documentação oficial v3.3.3.12 (50ª edição) e no WSDL de produção
(`https://pms.omnibees.com/OTA2014B/PullWebService.asmx`).

Escrito em linguagem simples para decisão de negócio — os detalhes técnicos ficam
no final de cada seção, marcados como *"para o time técnico"*.

---

## 1. O que é essa integração, em uma frase

A Omnibees é o **channel manager**: ela distribui o hotel nos canais de venda
(Booking.com, Expedia, agências, site próprio) e centraliza o que acontece lá.
Essa API permite que o **nosso sistema converse diretamente com a Omnibees no
papel de PMS do hotel** — recebendo as reservas que entram pelos canais e
enviando de volta disponibilidade, preços e restrições.

## 2. O que precisamos para começar (vale para tudo abaixo)

| Item | O que é | Quem fornece |
|---|---|---|
| **UserCode** | O "nome" do nosso sistema registrado na Omnibees (ex.: `Fluxo`) | Omnibees, ao criar a integração |
| **Username / Password** | Credenciais de acesso do nosso sistema | Omnibees |
| **HotelCode** | Código de cada hotel dentro da Omnibees | Omnibees (por hotel) |
| **ChainCode** | Código da rede — só quando a Omnibees configura assim | Omnibees |
| **Mapeamento hotel ↔ PMS** | A Omnibees precisa "ligar" cada hotel ao nosso UserCode e liberar quais mensagens podemos usar | Suporte Omnibees |

⚠️ **Importante**: as credenciais são exclusivas por parceiro. As credenciais que a
Erbon usa (UserCode `Erbon`) **não podem ser reutilizadas** por nós — a Omnibees
recusa ("Invalid hotel code / PMS mappings") e, se aceitasse, nós "roubaríamos" as
reservas que deveriam chegar à Erbon. Já validamos isso na prática (08/07/2026).

Existe um **ambiente de certificação** (`pmscert.omnibees.com`) para homologar
tudo antes de ir para produção — a Omnibees normalmente exige essa homologação.

*Para o time técnico*: protocolo SOAP/XML padrão OTA 2014B; credenciais vão no
header de cada mensagem; todas as datas em UTC; nosso cliente já está implementado
em `src/lib/omnibeesService.ts` com proxy em `netlify/functions/omnibees-proxy.ts`.

---

## 3. As mensagens disponíveis, uma a uma

### 3.1 Receber Reservas (o coração da integração) — `OTA_Read` (Pull)

**O que precisamos enviar:** o HotelCode e uma janela de datas de **criação** da
reserva (não é a data de check-in!). Limite: a data inicial não pode ser mais
antiga que **5 dias**. Pedimos sempre "AllUndelivered" (todas as não entregues).

**O que retorna:** a lista completa de reservas novas, alteradas e canceladas que
entraram pelos canais, cada uma com:
- Hóspede principal e acompanhantes (nome, e-mail, telefone, documento, endereço)
- Datas de check-in/check-out, tipo de quarto e plano tarifário
- Quantidade de adultos/crianças, valor total, impostos, valor por diária
- Canal de origem (Booking, Expedia, site...), segmento
- Política de cancelamento, garantia (cartão de crédito via gateway), pensão
  (café, meia pensão...), comentários do hóspede

**Obrigação que vem junto:** cada reserva recebida precisa ser **confirmada**
(mensagem `OTA_NotifReport`, ver 3.2). Sem confirmação a Omnibees considera "não
entregue" e reenvia. Após 6 falhas técnicas ela marca como "failed".

**Possibilidades de uso no Fluxo:**
- ✅ **Já implementado**: reservas dos canais aparecem automaticamente no Planning
  e no Rack dos hotéis operados pelo Fluxo (viram reservas internas, com canal e
  valor; a UH é atribuída pela recepção, pois a Omnibees trabalha por *tipo* de
  quarto, não por apartamento específico).
- Alertas de nova reserva (push notification/WhatsApp para a recepção).
- Relatório de pick-up por canal (quantas reservas entraram por dia, de onde).

**Uso de mercado:** é exatamente assim que PMSs como Erbon, Desbravador e Hits
recebem reservas da Omnibees. O padrão do mercado é consultar a cada 5–15 minutos.

---

### 3.2 Confirmar o recebimento — `OTA_NotifReport`

**O que enviamos:** a lista dos números de reserva que processamos, com sucesso ou
com aviso. Podemos anexar o nosso número interno de reserva ("PMS Number"), que a
Omnibees guarda e exibe para o hotel.

**O que retorna:** um "ok" simples.

**Regras de ouro da documentação:**
- Nunca se pode **rejeitar** uma reserva por motivo de negócio (overbooking, tarifa
  errada...) — problemas de negócio viram *warning*, e a reserva é aceita.
- Erro técnico pode ser reportado, e a Omnibees reenvia (até 6 tentativas).

**Uso combinado:** sempre em dupla com o `OTA_Read` (3.1). Já implementado.

---

### 3.3 Enviar Disponibilidade/Inventário — `OTA_HotelInvCountNotif`

**O que enviamos:** para cada tipo de quarto e cada data, **quantas unidades ainda
temos para vender**.

**O que retorna:** confirmação de processamento.

**Possibilidades de uso:**
- **Anti-overbooking** (o caso mais valioso): quando alguém cria uma reserva
  interna no Planning do Fluxo, recalculamos as UHs livres daquela categoria e
  avisamos a Omnibees — os canais param de vender o que não existe mais.
- Fechar venda de datas específicas (eventos, manutenção de andar inteiro).

**Combinações:** funciona em conjunto com 3.1 — reserva de canal desconta do nosso
lado, reserva interna desconta do lado deles. É o ciclo completo de paridade de
inventário.

**Uso de mercado:** todo PMS sério faz isso; sem esse envio o hotel precisa
atualizar disponibilidade manualmente no painel da Omnibees (trabalho e risco).

---

### 3.4 Criar Planos Tarifários — `RateHeadersNotif` (OTA_HotelRatePlanNotif)

**O que enviamos:** a estrutura da tarifa — nome do plano, tipo de quarto ligado,
pensão incluída (café, meia pensão...), vigência.

**O que retorna:** confirmação com o código do plano criado.

**Possibilidades de uso:** criar/renomear tarifários direto do Fluxo (ex.: "Tarifa
Balcão", "Pacote Réveillon"), sem entrar no painel Omnibees.

**Uso de mercado:** menos comum — muitos hotéis preferem criar planos no painel
da Omnibees e usar a API só para preços/disponibilidade. É o "passo 1" obrigatório
antes de enviar preços de um plano que ainda não existe.

---

### 3.5 Enviar Preços — `RateDetailsNotif` (OTA_HotelRateAmountNotif)

**O que enviamos:** o valor da diária por plano tarifário, tipo de quarto, data e
ocupação (preço para 1 pessoa, 2 pessoas, criança...).

**O que retorna:** confirmação.

**Possibilidades de uso:**
- Tela de tarifário no Fluxo: mudar o preço de um período e refletir em todos os
  canais de uma vez.
- Precificação dinâmica futura (regras por ocupação: "acima de 80% de ocupação,
  sobe 15%") — o Fluxo já sabe a ocupação em tempo real.

**Uso de mercado:** junto com disponibilidade, é o envio mais usado do dia a dia
("abre/fecha e preço"). Revenue managers vivem disso.

---

### 3.6 Enviar Restrições — `OTA_HotelAvailNotif` (restrições)

**O que enviamos:** regras de venda por data/plano/quarto: mínimo e máximo de
noites, fechado para chegada (*closed to arrival*), fechado para saída, stop sell.

**O que retorna:** confirmação.

**Possibilidades de uso:** feriados com mínimo de 3 noites, fechar chegadas no dia
do Réveillon, bloquear venda de uma categoria.

**Uso de mercado:** usado por hotéis de lazer em alta temporada — é o que impede
reservas de 1 noite num feriadão.

---

### 3.7 Enviar Allotment — `AllotmentsAndRateRestrictionsNotif`

**O que enviamos:** quotas de quartos reservadas para canais/operadoras
específicas (ex.: 5 quartos garantidos para a operadora X até 30 dias antes).

**Possibilidades de uso:** gestão de contratos com operadoras. Nicho — só faz
sentido para hotéis que trabalham com allotment contratado.

---

### 3.8 Enviar Perfis — `ProfilesNotif` (OTA_ProfileCreate)

**O que enviamos:** cadastros de hóspedes, agências ou empresas (nome, contatos,
documentos, endereço).

**Possibilidades de uso:** manter a base de clientes corporativos sincronizada
com a Omnibees (para tarifas acordo/corporativas). Baixa prioridade para nós.

---

### 3.9 Consultar Canais — `GetChannels`

**O que retorna:** a lista dos canais de venda ativos do hotel na Omnibees, com
códigos.

**Possibilidades de uso:** exibir na tela de configuração quais canais o hotel
tem, e traduzir o código do canal que vem na reserva para um nome amigável.

---

### 3.10 Detalhes de Pagamento — `GetPaymentGatewayDetail`

**O que enviamos:** o número da reserva.

**O que retorna:** os dados de pagamento/garantia guardados no cofre (gateway) da
Omnibees — cartão tokenizado, status 3DS, valor da garantia.

**Possibilidades de uso:** para reservas pré-pagas ou garantidas por cartão,
a recepção consegue ver a forma de garantia sem entrar no painel. Envolve dado
sensível (PCI) — usar com parcimônia e nunca armazenar cartão aberto.

---

### 3.11 Ping — `OTA_Ping`

**O que faz:** teste de vida — valida credenciais e conectividade. Já usamos no
botão "Testar Conexão" da tela de configuração.

---

### 3.12 Modo Push (alternativa ao Pull) — `ReservationsNotif` / `OTA_HotelResNotif`

Em vez de nós perguntarmos ("Pull"), a Omnibees pode **empurrar** cada reserva
para um endereço nosso na hora em que ela acontece ("Push").

**Restrição crítica:** Push e Pull de reservas **não podem coexistir para o mesmo
hotel**. É um ou outro, definido no mapeamento da Omnibees.

**Nossa recomendação:** Pull. Mais simples de operar (não exige endpoint público
sempre disponível), mais fácil de homologar, e uma consulta a cada 5–15 min é
suficiente para operação hoteleira. Push só se um dia precisarmos de reserva
"instantânea" (ex.: day use com confirmação em segundos).

---

## 4. Combinações práticas (o que faz sentido juntar)

| Combinação | Resultado |
|---|---|
| 3.1 + 3.2 (reservas + confirmação) | **Fase 1 — feita.** Reservas dos canais dentro do Fluxo. |
| Fase 1 + 3.3 (inventário) | **Fase 2 — recomendada.** Ciclo anti-overbooking completo: interno ↔ canais. |
| Fase 2 + 3.5 + 3.6 (preços + restrições) | **Fase 3.** Tarifário gerenciado pelo Fluxo; painel Omnibees vira retaguarda. |
| 3.9 + 3.1 | Nome amigável do canal em cada reserva do Planning. |
| 3.10 + 3.1 | Garantia/cartão visível na reserva para a recepção. |
| 3.4 + 3.5 | Criar plano novo e já precificar, tudo pelo Fluxo. |

## 5. Como fica a regra de fontes no Fluxo (implementada)

Prioridade por hotel, decidida automaticamente:

1. **Omnibees ativa** → o Planning/Rack operam no modo interno do Fluxo e
   sincronizam as reservas dos canais via Omnibees (foco principal).
2. **Sem Omnibees, com Erbon** → os dados vêm da Erbon (reservas, conta corrente,
   housekeeping). É o caso atual das 2 unidades com Erbon — nada muda para elas.
3. **Nenhuma das duas** → reservas internas manuais do Fluxo (criar, editar,
   pagamentos, check-in/out, web-checkin).

*Cenário futuro "Omnibees + Erbon juntas" (dados da reserva pela Omnibees e conta
corrente pela Erbon): tecnicamente possível cruzando o número da reserva, mas hoje
não é necessário — nenhuma unidade tem as duas ativas, e a Erbon já recebe a
Omnibees por dentro.*

## 6. Limites e cuidados (resumo do que a documentação impõe)

- Janela do Pull de reservas: **máximo 5 dias para trás** (por data de criação) —
  por isso a sincronização precisa rodar com frequência; se ficar mais de 5 dias
  sem rodar, reservas podem ficar "presas" (a Omnibees ainda as listará como não
  entregues, mas é bom não arriscar).
- **Confirmação é obrigatória** e não se pode rejeitar reserva por negócio.
- **Push e Pull de reservas são excludentes** por hotel.
- Todas as datas trafegam em **UTC**.
- Homologação no ambiente de certificação (`pmscert`) antes de produção.
- Credenciais por parceiro — nunca reutilizar as de outro PMS.

## 7. Próximos passos sugeridos

1. **Comercial**: solicitar à Omnibees a criação do PMS "Fluxo" (modo Pull) e o
   mapeamento dos hotéis sem Erbon; pedir acesso ao ambiente de certificação.
2. **Homologação**: testar Ping, Read e NotifReport no `pmscert` (a tela
   `Configurações → Omnibees` já aceita a URL de certificação).
3. **Fase 2**: implementar o envio de inventário (3.3) a partir das reservas
   internas — fecha o risco de overbooking.
4. **Fase 3**: tela de tarifário (preços + restrições) quando a operação pedir.
