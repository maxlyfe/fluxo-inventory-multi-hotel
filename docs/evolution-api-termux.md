# Evolution API no Android via Termux

Guia para rodar o Evolution API em um celular Android com Termux e Ubuntu em
proot. Testado no contexto de um Poco M6 Pro (HyperOS, 12 GB de RAM, ARM64).

Alternativa gratuita a servidor, aproveitando que o celular fica ligado 24h.

> **Docker não funciona em Termux** (sem root, sem namespaces do kernel). O stack
> em `docker/evolution/` não serve aqui. A instalação é nativa, com npm.

## Arquitetura

O celular roda apenas dois processos: o Evolution e o túnel. O banco fica no
Supabase que você já usa, e o Redis é dispensado em favor do cache local.

```
Fluxo (Netlify) ──▶ Cloudflare Tunnel ──▶ Evolution (celular) ──▶ WhatsApp
                                              │
                                              ▼
                                     Postgres do Supabase
```

---

## Parte 1: Termux

### 1.1 Instalar pela F-Droid, não pela Play Store

A versão da Play Store está descontinuada e quebra. Baixe da
[F-Droid](https://f-droid.org/packages/com.termux/):

- **Termux**
- **Termux:Boot** (religa tudo depois de reiniciar o celular)
- **Termux:API** (necessário para o wake lock)

### 1.2 Pacotes base

```bash
pkg update && pkg upgrade -y
```

```bash
pkg install -y proot-distro termux-api
```

### 1.3 Ubuntu no proot

Pule se já tiver.

```bash
proot-distro install ubuntu
```

---

## Parte 2: Sobrevivência no Android

Sem estes três ajustes o processo morre em algumas horas e você só descobre
quando faltar mensagem. No HyperOS os caminhos são estes:

1. **Sem restrição de bateria**
   Ajustes › Aplicativos › Gerenciar aplicativos › Termux › Economia de bateria
   › **Sem restrições**

2. **Autostart ativado**
   Ajustes › Aplicativos › Permissões › Autostart › ativar **Termux**

3. **Travar nos recentes**
   Abra os apps recentes, pressione e segure o Termux, toque no **cadeado**

Faça o mesmo para o Termux:Boot.

---

## Parte 3: Banco no Supabase

No painel do Supabase: Project Settings › Database › Connection string.

Existem três opções ali, e a escolha importa:

| Opção | Porta | Serve? |
|---|---|---|
| Direct connection | 5432 | **Não.** É IPv6 only. Em rede móvel costuma falhar. |
| **Session pooler** | 5432 | **Sim.** Aceita IPv4 e suporta as migrations do Prisma. |
| Transaction pooler | 6543 | Não. Sem prepared statements, quebra o Prisma. |

Copie a string do **Session pooler**. Ela tem este formato, com o host em
`pooler.supabase.com` e o usuário incluindo o ref do projeto:

```
postgresql://postgres.SEU_REF:SUA_SENHA@aws-0-SUA_REGIAO.pooler.supabase.com:5432/postgres?schema=evolution_api
```

Acrescente `?schema=evolution_api` no final para isolar as tabelas do Evolution
das do Fluxo.

Confira se a conexão direta do seu projeto realmente não tem IPv4:

```bash
nslookup -type=A db.SEU_REF.supabase.co
```

Sem registro A, use o pooler. Com registro A, qualquer um dos dois funciona.

> A senha do banco é uma credencial separada do JWT. Rotacionar as chaves da API
> do Supabase não invalida esta conexão.

### Alternativa: PostgreSQL local

Se o pooler der problema, dá para rodar o Postgres dentro do proot. Custa uns
300 MB de RAM e exige subir o serviço manualmente, porque `service` não funciona
em proot:

```bash
apt install -y postgresql && pg_ctlcluster 16 main start
```

```bash
su postgres -c "psql -c \"CREATE USER evolution WITH PASSWORD 'trocar'; CREATE DATABASE evolution OWNER evolution;\""
```

A URI fica `postgresql://evolution:trocar@localhost:5432/evolution?schema=public`,
e o `pg_ctlcluster` precisa entrar no script de start da Parte 6.

---

## Parte 4: Evolution

Entre no Ubuntu. Todos os comandos daqui para baixo são dentro dele.

```bash
proot-distro login ubuntu
```

### 4.1 Dependências

```bash
apt update && apt install -y curl git ffmpeg openssl ca-certificates
```

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
```

Confirme que veio a 20 ou superior:

```bash
node -v
```

### 4.2 Clonar e instalar

```bash
cd /root && git clone https://github.com/evolution-foundation/evolution-api.git
```

```bash
cd /root/evolution-api && npm install
```

O `npm install` baixa binários prontos de `sharp` e do Prisma para linux-arm64.
Demora alguns minutos e é a etapa mais propensa a falhar. Se der erro de
compilação, veja [Problemas](#problemas).

### 4.3 Gerar a API Key

Guarde o valor: é ele que vai no campo **API Key** da tela do Fluxo.

```bash
openssl rand -hex 32
```

### 4.4 Configurar o .env

```bash
cd /root/evolution-api && cp .env.example .env && nano .env
```

Ajuste estas linhas. As demais podem ficar como estão:

```env
SERVER_PORT=8080
# Preencha depois de criar o túnel (Parte 5)
SERVER_URL=https://SEU_ENDERECO_DO_TUNEL

AUTHENTICATION_API_KEY=cole-aqui-a-chave-do-passo-4.3

DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres.SEU_REF:SENHA@aws-0-SUA_REGIAO.pooler.supabase.com:5432/postgres?schema=evolution_api

# Sessão precisa persistir, senão o QR é pedido a cada restart
DATABASE_SAVE_DATA_INSTANCE=true
# O Fluxo guarda as mensagens. Não duplicar aqui economiza banco e bateria.
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

# Sem Redis no celular: cache em memória
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

# O webhook é configurado por instância pela UI do Fluxo
WEBHOOK_GLOBAL_ENABLED=false

CONFIG_SESSION_PHONE_CLIENT=Fluxo
CONFIG_SESSION_PHONE_NAME=Chrome

LANGUAGE=pt-BR
LOG_LEVEL=ERROR,WARN
LOG_BAILEYS=error
```

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

### 4.5 Migrations e build

```bash
cd /root/evolution-api && npm run db:deploy
```

Primeiro gere o client do Prisma. O `db:deploy` roda `migrate deploy`, que aplica
as migrations mas **não** gera o client, e sem ele o servidor sobe e morre com
`@prisma/client did not initialize yet`:

```bash
cd /root/evolution-api && npx prisma generate --schema ./prisma/postgresql-schema.prisma
```

Não use `npm run build`. O script é `tsc --noEmit && tsup`, e o typecheck falha em
vários arquivos do repositório. Como falha antes do `tsup`, o `dist/` nem chega a
ser criado, e o `start:prod` morre com `Cannot find module dist/main`.

O typecheck não é necessário para gerar o bundle. Chame o `tsup` direto:

```bash
cd /root/evolution-api && npx tsup
```

Se o `tsup` também falhar, rode direto do TypeScript com `tsx`, sem build. Neste
caso troque `start:prod` por `start` em todos os passos seguintes, inclusive no
script da Parte 6:

```bash
cd /root/evolution-api && npm run start
```

### 4.6 Primeiro teste

Suba em background, para não precisar de uma segunda sessão:

```bash
cd /root/evolution-api && nohup npm run start:prod > /root/evolution.log 2>&1 &
```

Espere uns 15 segundos e teste na mesma sessão:

```bash
curl -s http://localhost:8080/ | head -c 200
```

Deve devolver um JSON com nome e versão. Se não responder, veja o motivo:

```bash
tail -20 /root/evolution.log
```

---

## Parte 5: Túnel

### 5.1 Instalar o cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
```

### 5.2 Túnel rápido, para validar

Rode gravando a saída em arquivo, senão o endereço se perde no meio do log:

```bash
nohup cloudflared tunnel --url http://localhost:8080 > /root/tunnel.log 2>&1 &
```

Espere uns 15 segundos e extraia o endereço:

```bash
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /root/tunnel.log | head -1
```

Esse é o valor do campo **URL base** no Fluxo.

**O endereço muda a cada reinício.** Para validar tudo funcionando serve, mas
para uso diário vá para o passo 5.3.

### 5.3 Túnel nomeado, com endereço fixo

Requer o domínio no Cloudflare, no plano gratuito.

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create fluxo-evolution
```

```bash
cloudflared tunnel route dns fluxo-evolution evolution.lyfehoteles.com.br
```

Crie o arquivo de configuração:

```bash
mkdir -p /root/.cloudflared && nano /root/.cloudflared/config.yml
```

```yaml
tunnel: fluxo-evolution
credentials-file: /root/.cloudflared/SEU_TUNNEL_ID.json
ingress:
  - hostname: evolution.lyfehoteles.com.br
    service: http://localhost:8080
  - service: http_status:404
```

Rode com:

```bash
cloudflared tunnel run fluxo-evolution
```

Agora a URL base é `https://evolution.lyfehoteles.com.br`, estável.

---

## Parte 6: Subir tudo com um comando

Crie o script de inicialização dentro do Ubuntu:

```bash
nano /root/start-evolution.sh
```

```bash
#!/bin/bash
# Sobe o Evolution e o túnel, reiniciando cada um se cair.

cd /root/evolution-api

while true; do
  npm run start:prod >> /root/evolution.log 2>&1
  echo "[$(date)] evolution caiu, reiniciando em 10s" >> /root/evolution.log
  sleep 10
done &

while true; do
  cloudflared tunnel run fluxo-evolution >> /root/tunnel.log 2>&1
  echo "[$(date)] tunel caiu, reiniciando em 10s" >> /root/tunnel.log
  sleep 10
done &

wait
```

```bash
chmod +x /root/start-evolution.sh
```

### Autostart no boot

Saia do Ubuntu (`exit`) e, no Termux:

```bash
mkdir -p ~/.termux/boot && nano ~/.termux/boot/evolution
```

```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
proot-distro login ubuntu -- /root/start-evolution.sh
```

```bash
chmod +x ~/.termux/boot/evolution
```

Reinicie o celular para confirmar que sobe sozinho.

### Iniciar manualmente

```bash
termux-wake-lock && proot-distro login ubuntu -- /root/start-evolution.sh
```

---

## Parte 7: Conectar no Fluxo

Em **Configurações › Integração WhatsApp**, no site publicado:

| Campo | Valor |
|---|---|
| Provider | Evolution API |
| URL base | `https://evolution.lyfehoteles.com.br` |
| API Key | a chave do passo 4.3 |
| Nome da instância | `compras-meridiana` (minúsculas, sem espaço) |

**Salvar Configuração** primeiro, depois **Criar instância e conectar**, e leia o
QR Code no WhatsApp de compras: Configurações › Aparelhos conectados › Conectar
aparelho.

O celular continua funcionando normalmente. O Evolution entra como aparelho
vinculado, e o que você responder pelo celular também aparece no inbox do Fluxo.

---

## Manutenção

Ver os logs:

```bash
proot-distro login ubuntu -- tail -f /root/evolution.log
```

Estado das instâncias:

```bash
curl -s -H "apikey: SUA_API_KEY" http://localhost:8080/instance/fetchInstances
```

Atualizar o Evolution:

```bash
cd /root/evolution-api && git pull && npm install && npm run db:deploy && npm run build
```

---

## Problemas

| Sintoma | Causa |
|---|---|
| Para de responder depois de horas | Wake lock ou otimização de bateria. Revise a Parte 2. |
| Não sobe depois de reiniciar | Termux:Boot não instalado, ou Autostart desativado. |
| `npm install` falha em `sharp` | `apt install -y build-essential python3` e tente novamente. |
| `Cannot find module dist/main` | O `npm run build` falhou no typecheck. Use `npx tsup`, ou rode com `npm run start`. |
| `@prisma/client did not initialize yet` | Falta gerar o client: `npx prisma generate --schema ./prisma/postgresql-schema.prisma`. |
| `db:deploy` falha com timeout ou "no route to host" | Você usou a conexão direta, que é IPv6 only. Troque pelo Session pooler. |
| `db:deploy` falha com erro de prepared statement | Você usou o Transaction pooler (6543). Troque pelo Session pooler (5432). |
| `db:deploy` falha com senha inválida | A senha do banco não é a service_role. Pegue ou redefina em Project Settings › Database. |
| Instância cai ao trocar wifi e dados | Normal, o Baileys reconecta. Se ficar em `close`, leia o QR de novo. |
| QR Code não aparece no Fluxo | Confira se o túnel está no ar abrindo a URL base no navegador. |
| Envio funciona mas não recebe nada | A URL base mudou e o webhook ficou no endereço antigo. Clique em **Reaplicar webhook**. |

## Limites deste arranjo

Cada instância do Baileys consome de 150 a 250 MB. Com 12 GB no aparelho, os
quatro hotéis cabem, mas o Android pode matar processos sob pressão de memória se
você usar o celular intensamente.

Rodar o servidor no mesmo aparelho que tem o WhatsApp concentra tudo em um ponto
único de falha: perder o celular significa perder os dois.

Se a operação crescer, o **Oracle Cloud Always Free** oferece uma VM ARM gratuita
permanente onde o `docker/evolution/` funciona direto, sem lutar contra a
gestão de bateria do Android. Ver `docs/evolution-api-deploy.md`.
