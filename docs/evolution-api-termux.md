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

No painel do Supabase: Project Settings › Database › Connection string › **URI**.

Use a conexão direta (porta 5432), não o pooler, porque o Prisma precisa rodar
migrations. Acrescente o schema no final para isolar as tabelas do Evolution das
do Fluxo:

```
postgresql://postgres:SUA_SENHA@db.SEU_REF.supabase.co:5432/postgres?schema=evolution_api
```

Guarde essa string: ela vai no `.env` do Evolution.

> A senha do banco é uma credencial separada do JWT. Rotacionar as chaves da API
> do Supabase não invalida esta conexão.

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
DATABASE_CONNECTION_URI=postgresql://postgres:SENHA@db.SEU_REF.supabase.co:5432/postgres?schema=evolution_api

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

```bash
cd /root/evolution-api && npm run build
```

### 4.6 Primeiro teste

```bash
cd /root/evolution-api && npm run start:prod
```

Em outra aba do Termux (deslize da esquerda › New session):

```bash
curl -s http://localhost:8080/ | head -c 200
```

Deve devolver um JSON com nome e versão. Se sim, pare com `Ctrl+C` e siga.

---

## Parte 5: Túnel

### 5.1 Instalar o cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
```

### 5.2 Túnel rápido, para validar

```bash
cloudflared tunnel --url http://localhost:8080
```

Ele imprime um endereço `https://algo-aleatorio.trycloudflare.com`. Esse é o
valor do campo **URL base** no Fluxo.

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
| Erro de conexão no `db:deploy` | Use a porta 5432 (direta), não 6543 (pooler). Confira a senha. |
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
