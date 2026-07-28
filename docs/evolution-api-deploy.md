# Evolution API: deploy e integração com o Fluxo

Alternativa gratuita à Meta Cloud API para a automação de mensagens. O software é
open source (Apache 2.0), mas precisa de uma máquina sempre ligada, então o custo
sai na hospedagem, não na licença.

## Sumário

1. [Como funciona](#como-funciona)
2. [O que você precisa antes de começar](#o-que-você-precisa-antes-de-começar)
3. [Oracle Cloud Always Free](#oracle-cloud-always-free) (gratuito, recomendado)
4. [Deploy na VPS](#deploy-na-vps)
5. [Configuração no Fluxo](#configuração-no-fluxo)
6. [Variáveis no Netlify](#variáveis-no-netlify)
7. [Operação e manutenção](#operação-e-manutenção)
8. [Riscos e limites](#riscos-e-limites)
9. [Diagnóstico de problemas](#diagnóstico-de-problemas)

---

## Como funciona

O Evolution API expõe uma API REST em cima do protocolo do WhatsApp Web. Você
conecta um número comum lendo um QR Code, e a partir daí envia e recebe mensagens
por HTTP. Não passa pelo Meta Business Manager.

```
Fluxo (Netlify)                         VPS                        WhatsApp
─────────────────                  ─────────────                 ──────────
UI React
  │
  ├─ envio ──▶ /.netlify/functions/evolution-proxy ──▶ Caddy ──▶ Evolution ──▶ WhatsApp Web
  │                                                                  │
  └─ inbox ◀── /.netlify/functions/whatsapp-webhook ◀── webhook ◀─────┘
                            │
                            ▼
                        Supabase
```

O proxy existe para que a apikey nunca chegue ao browser. O webhook é o mesmo
endpoint usado pela Meta: ele identifica o provider pelo formato do payload.

### O que muda em relação à Meta

| | Meta Cloud API | Evolution API |
|---|---|---|
| Custo | Por conversa iniciada | Só a hospedagem |
| Templates | Aprovação prévia obrigatória | Texto livre |
| Janela de 24h | Fora dela só template | Não existe |
| Homologado pela Meta | Sim | Não |
| Risco de bloqueio | Praticamente nulo | Real |
| Número | Dedicado à API | Número comum, segue no celular |

O celular continua funcionando normalmente. O Evolution entra como **aparelho
vinculado**, e o celular segue sendo o principal. Como o webhook captura as duas
direções, o que a equipe responder pelo celular também aparece no inbox do Fluxo.

O que não se pode é conectar o mesmo número em duas instâncias do Evolution.

---

## O que você precisa antes de começar

Existem dois cenários. Escolha um antes de seguir.

### Cenário A: servidor 24h (recomendado para produção)

- Uma máquina Linux com Docker, sempre ligada. Um plano de 2 vCPU e 4 GB de RAM
  já roda com folga as quatro instâncias do grupo. Hetzner CX22 e Contabo VPS S
  ficam na faixa de R$30 a R$60 por mês. O **Oracle Cloud Always Free** oferece
  uma VM ARM permanentemente gratuita, sem trial que expira, e é mais que
  suficiente aqui.
- Um subdomínio apontando para o IP da máquina, por exemplo
  `evolution.meridianahoteles.com` (registro A no DNS).
- Portas 80 e 443 abertas.

### Cenário B: no seu próprio PC, com túnel gratuito

Funciona sem contratar nada, mas só enquanto o computador estiver ligado.
Detalhes e limitações em [Rodando no próprio PC](#rodando-no-próprio-pc).

### Em qualquer cenário

- Um chip de WhatsApp por hotel, de preferência já com histórico de conversas.

---

## Oracle Cloud Always Free

Caminho recomendado para quem não quer custo mensal. A VM é ARM e a imagem do
Evolution tem build `linux/arm64`, então o `docker-compose.yml` deste repositório
roda sem alteração.

O Always Free dá até 4 OCPU e 24 GB de RAM em instâncias A1, permanentemente, sem
trial que expira. O cartão é pedido só para verificação de identidade.

### 1. Criar a conta

Em [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Escolha a região
mais próxima na criação: ela vira sua *home region* e não muda depois.

### 2. Criar a instância

Compute › Instances › Create instance:

- **Image**: Ubuntu 24.04
- **Shape**: `VM.Standard.A1.Flex`, com **1 OCPU e 6 GB** de RAM
- **SSH keys**: salve a chave privada, é o único acesso à máquina

> **"Out of host capacity"** é o erro mais comum aqui: a capacidade ARM gratuita
> costuma estar esgotada. Tente outro *availability domain* no mesmo formulário,
> ou repita depois de algumas horas. Não é problema da sua conta.

Anote o **Public IP** da instância.

### 3. Liberar as portas, nos dois lugares

Isto pega quase todo mundo: a Oracle bloqueia em duas camadas independentes, e é
preciso abrir nas duas.

**Camada 1, na nuvem.** Na página da instância, clique na *Subnet* › *Security
List* › Add Ingress Rules. Crie duas regras:

| Source CIDR | Protocolo | Porta |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**Camada 2, dentro da VM.** As imagens Ubuntu da Oracle vêm com iptables
bloqueando tudo menos SSH. Depois de conectar por SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
```

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
```

```bash
sudo netfilter-persistent save
```

Sem a camada 2, o Caddy nunca consegue emitir o certificado e você fica com erro
de HTTPS sem entender o motivo.

### 4. Apontar o DNS

Crie um registro **A** para `evolution.seudominio.com.br` apontando para o Public
IP da instância. Espere resolver antes de seguir:

```bash
nslookup evolution.seudominio.com.br
```

### 5. Instalar o Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

### 6. Subir o stack

Copie os três arquivos de `docker/evolution/` para a VM e siga a partir do
passo 3 de [Deploy na VPS](#deploy-na-vps).

---

## Deploy na VPS

### 1. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Copiar os arquivos do stack

Os três arquivos estão em `docker/evolution/` neste repositório:
`docker-compose.yml`, `Caddyfile` e `.env.example`.

```bash
mkdir -p /opt/evolution && cd /opt/evolution
```

Copie os três arquivos para essa pasta (via `scp`, `git clone` ou colando o
conteúdo com um editor).

### 3. Preencher o .env

```bash
cp .env.example .env
```

Gere os segredos:

```bash
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"
```

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
```

Cole os valores no `.env` junto com `EVOLUTION_DOMAIN` e `ACME_EMAIL`.
Guarde a `EVOLUTION_API_KEY`: ela é a credencial que você vai colar no Fluxo.

### 4. Subir

```bash
docker compose up -d
```

Acompanhe até o Caddy emitir o certificado e o Evolution reportar que subiu:

```bash
docker compose logs -f
```

### 5. Validar

```bash
curl -s https://SEU_DOMINIO/ | head -c 300
```

Deve responder um JSON com nome e versão da API. Se responder erro de
certificado, o DNS provavelmente ainda não propagou.

---

## Configuração no Fluxo

### 1. Aplicar a migration

```bash
supabase db push
```

Ou rode `supabase/migrations/20260728120000_whatsapp_evolution_provider.sql`
manualmente no SQL Editor do Supabase.

Ela adiciona `provider`, `base_url`, `api_key` e `instance_name` em
`whatsapp_configs`, cria `body_text` em `whatsapp_message_templates` e preenche o
corpo dos três templates existentes.

### 2. Conectar cada hotel

Em **Configurações › Integração WhatsApp**, com o hotel selecionado:

1. Escolha o provider **Evolution API**.
2. Preencha:
   - **URL base**: `https://evolution.seudominio.com.br`
   - **API Key**: a `EVOLUTION_API_KEY` do `.env`
   - **Nome da instância**: um identificador por hotel, por exemplo
     `costa-do-sol`, `brava-club`, `vila-pitanga`, `maria-maria`.
     Precisa ser único entre todos os hotéis, porque é por ele que o webhook
     descobre de onde veio a mensagem.
3. Clique em **Salvar Configuração**. Isso precisa vir antes de conectar, senão o
   webhook não consegue identificar a instância quando as mensagens chegarem.
4. Clique em **Criar instância e conectar**. O QR Code aparece na tela.
5. No celular do número: **Configurações › Aparelhos conectados › Conectar
   aparelho**, e aponte para o código. Ele expira em cerca de 1 minuto; se
   passar, clique em conectar novamente.
6. O selo de estado muda para **Conectado** sozinho, em até 3 segundos.

Repita para os quatro hotéis, cada um com sua instância e seu chip.

### 3. Revisar os corpos de mensagem

Na aba **Templates**, cada template tem um campo **Corpo em texto puro
(Evolution)**. Os três padrões já vêm preenchidos pela migration, mas revise o
texto, porque agora ele é enviado literalmente, sem passar pela Meta.

Os placeholders `{{1}}`, `{{2}}`, `{{3}}` recebem os mesmos parâmetros que já
eram enviados para a Meta. A correspondência está descrita na linha
"Parâmetros" de cada template.

---

## Variáveis no Netlify

Nenhuma variável nova é obrigatória. As credenciais do Evolution ficam no
Supabase, por hotel.

Uma opcional:

| Variável | Quando usar |
|---|---|
| `EVOLUTION_ALLOWED_HOSTS` | Lista de hostnames separados por vírgula. O `evolution-proxy` só aceita destinos HTTPS públicos; use esta variável para liberar HTTP ou um host interno em ambiente de teste. |

O bloqueio existe porque a URL base vem do banco e é editável na tela. Sem ele, o
proxy poderia ser usado para alcançar a rede interna do provedor.

---

## Operação e manutenção

### Backup

O que importa é o volume `postgres_data`, que guarda a sessão do WhatsApp. Sem
ele, todas as instâncias pedem QR Code de novo.

```bash
docker compose exec -T postgres pg_dump -U evolution evolution | gzip > evolution-$(date +%F).sql.gz
```

### Atualizar versão

A tag no `docker-compose.yml` está fixada em `v2.3.7` de propósito: `latest` já
introduziu mudança de contrato entre minor versions. Para atualizar, mude a tag,
leia o changelog e então:

```bash
docker compose pull evolution && docker compose up -d evolution
```

### Reconectar uma instância caída

O Evolution reconecta sozinho na maioria dos casos. Quando o WhatsApp invalida a
sessão (troca de chip, logout no celular, muitos dias offline), o selo na tela
fica em **Desconectado** e é preciso ler o QR Code de novo.

### Logs

```bash
docker compose logs --tail 100 evolution
```

---

## Rodando no próprio PC

Dá para rodar o Evolution na sua máquina, sem contratar servidor. O que impede o
uso direto não é o WhatsApp, é a direção do tráfego: quem chama o Evolution no
envio é o `evolution-proxy`, uma Netlify Function rodando na nuvem, e ela não
alcança o `localhost` da sua máquina. Um túnel resolve isso de graça.

### Passo 1: subir o Evolution local

Use o mesmo `docker-compose.yml`, mas sem o Caddy (o túnel já entrega HTTPS):

```bash
docker compose up -d evolution postgres redis
```

Exponha a porta do Evolution para a máquina adicionando ao serviço `evolution`:

```yaml
    ports:
      - "8080:8080"
```

### Passo 2: abrir o túnel

Instale o `cloudflared` e rode:

```bash
cloudflared tunnel --url http://localhost:8080
```

Ele imprime um endereço público como `https://algo-aleatorio.trycloudflare.com`.
Esse é o valor do campo **URL base** na tela do Fluxo.

### Passo 3: conectar

Abra a tela de Integração WhatsApp **no site publicado**, não em `localhost:5173`.
A tela bloqueia a conexão quando detecta origem local, porque o webhook gravado na
instância apontaria para um endereço que só existe no seu computador, e as
mensagens recebidas desapareceriam sem erro visível.

### Quando o endereço do túnel mudar

O túnel gratuito gera um endereço novo a cada reinício do `cloudflared`. Quando
isso acontecer:

1. Atualize o campo **URL base** com o novo endereço e salve.
2. Clique em **Reaplicar webhook**.

Sem o passo 2, o envio volta a funcionar mas o recebimento continua apontando para
o endereço antigo. Para ter endereço fixo, crie um túnel nomeado no Cloudflare
usando um domínio seu, ainda no plano gratuito.

### O que você perde

| | PC ligado | PC desligado |
|---|---|---|
| Enviar mensagem | Funciona | Não funciona |
| Receber mensagem | Funciona | Chega atrasado, quando religar |
| Auto resposta | Funciona | **Não dispara** |
| Disparo em massa | Funciona | Não funciona |

Mensagem recebida não se perde: o WhatsApp guarda e entrega o acumulado quando a
instância reconecta. Mas a auto resposta simplesmente não acontece no período
offline, e é justamente ela que mais depende de disponibilidade contínua. Quem
mandar mensagem às 22h só vai ser respondido quando o computador voltar.

Dois cuidados adicionais: PC em suspensão ou hibernação derruba a sessão, e
reconexões frequentes aumentam a chance do WhatsApp invalidar a sessão de vez e
pedir o QR Code novamente. Vale desativar a suspensão automática na máquina que
ficar com essa função.

---

## Riscos e limites

**Bloqueio do número.** O protocolo do WhatsApp Web não é homologado para uso
automatizado. A Meta pode banir o número. As mitigações que já estão no código:

- Disparo em massa sai com intervalo aleatório de 3 a 8 segundos, não em rajada.
- Auto respostas saem com `delay` de 1,5s, porque resposta instantânea é assinatura
  de bot.
- Grupos são ignorados (`groupsIgnore: true`), tanto no envio quanto no inbox.

O que depende de disciplina de operação:

- Use número com histórico. Chip novo disparando em massa é o padrão que mais
  gera bloqueio.
- Nos primeiros dias, mantenha volume baixo e vá subindo.
- Não envie para quem nunca interagiu com o hotel.
- Se um número for bloqueado, a instância cai e o inbox daquele hotel para.
  Tenha um chip de reserva.

**Recomendação de divisão.** Vale manter a Meta Cloud API nos fluxos com hóspede,
onde um bloqueio custa reserva, e usar o Evolution nos fluxos internos e com
fornecedor. O provider é por hotel, então essa divisão é configurável na tela.

**Mídia recebida.** O webhook grava a URL e a `mediaKey` das mensagens de mídia,
mas o arquivo em si é criptografado pelo WhatsApp. Baixá-lo exige uma chamada
extra a `/chat/getBase64FromMediaMessage`, que ainda não está implementada. Áudio,
imagem e documento recebidos aparecem no inbox como rótulo, sem o conteúdo.

**Uma instância por número.** Não conecte o mesmo chip em duas instâncias, e não
use o celular ativamente no mesmo número que está no inbox.

---

## Diagnóstico de problemas

| Sintoma | Causa provável |
|---|---|
| QR Code não aparece | URL base errada, apikey errada, ou o Caddy ainda não emitiu o certificado. Teste com `curl https://SEU_DOMINIO/`. |
| QR lido mas o estado não muda | O polling consulta a cada 3s por até o tempo que a tela ficar aberta. Clique no ícone de atualizar ao lado do selo de estado. |
| Mensagem enviada mas não chega | Confira o estado da instância. `close` significa sessão perdida: leia o QR novamente. |
| Mensagem recebida não aparece no inbox | O `instance_name` salvo no Fluxo tem que ser idêntico ao nome da instância no Evolution. Confira também se o webhook está aplicado, com **Testar Conexão**. |
| Erro "Host de destino não permitido" | A URL base é HTTP ou aponta para IP privado. Use HTTPS público ou libere o host em `EVOLUTION_ALLOWED_HOSTS`. |
| Template sem corpo cadastrado | Preencha o campo **Corpo em texto puro** na aba Templates. |
| Conversa duplicada no inbox | Config global com `hotel_id` nulo. Prefira config por hotel quando usar Evolution, já que cada hotel tem sua própria instância. |

### Conferir o webhook aplicado em uma instância

```bash
curl -s -H "apikey: SUA_API_KEY" https://SEU_DOMINIO/webhook/find/NOME_DA_INSTANCIA
```

### Listar as instâncias e seus estados

```bash
curl -s -H "apikey: SUA_API_KEY" https://SEU_DOMINIO/instance/fetchInstances
```
