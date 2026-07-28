# Evolution API: guia rápido de operação

Cola do dia a dia. A instalação completa está em
[evolution-api-termux.md](evolution-api-termux.md).

---

## Ligar o servidor (celular)

Abra o **Termux**. O prompt tem que estar assim: `~ $`

Se estiver `root@localhost:~#`, digite `exit` até virar `~ $`.

### 1. Wake lock

```bash
termux-wake-lock
```

Sem isso o Android suspende a CPU e a conexão do WhatsApp cai em algumas horas,
sem derrubar o processo, o que é pior: parece estar tudo no ar e nada funciona.

### 2. Subir tudo em background

```bash
nohup proot-distro login ubuntu -- /root/start-evolution.sh > ~/supervisor.log 2>&1 &
```

O prompt volta na hora. O supervisor cuida do Evolution, do túnel e reconecta
sozinho se o socket cair.

### 3. Pegar o endereço do túnel

Espere 40 segundos e rode:

```bash
proot-distro login ubuntu -- sh -c 'grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /root/logs/tunnel.log | tail -1'
```

Repare no `tail -1`: o log acumula todos os reinícios, e `head -1` devolveria um
endereço antigo já morto.

### 4. Atualizar no Fluxo

Configurações › Integração WhatsApp, com **Costa do Sol** selecionado:

1. Cole o endereço em **URL base**
2. **Salvar Configuração**
3. **Reaplicar webhook**

O passo 3 não é opcional. Sem ele o envio funciona mas **nada é recebido**, porque
o webhook gravado na instância continua apontando para o endereço anterior. E não
aparece erro: as mensagens simplesmente não chegam.

O endereço muda a cada reinício do túnel, então estes 4 passos se repetem sempre
que o celular reiniciar.

---

## Conferir se está no ar

```bash
proot-distro login ubuntu -- sh -c 'echo "== PROCESSOS =="; pgrep -af "node dist/main" || echo "evolution PARADO"; pgrep -af cloudflared || echo "tunel PARADO"; echo "== EVOLUTION =="; curl -s -m 10 http://localhost:8080/ | head -c 60; echo; echo "== TUNEL =="; grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /root/logs/tunnel.log | tail -1'
```

Na tela do Fluxo, **Testar Conexão** também serve: ele faz um ping real no socket,
não só olha o estado em cache, então detecta o caso de "diz conectado mas não
envia".

---

## Desligar

```bash
proot-distro login ubuntu -- sh -c 'pkill -f "node dist/main"; pkill -f cloudflared'
```

```bash
termux-wake-unlock
```

---

## Quando algo falha

| Sintoma | Causa | O que fazer |
|---|---|---|
| `HTTP 530` no navegador | Túnel caiu | Refazer os 4 passos de ligar |
| `Connection Closed` no envio | Socket do WhatsApp caiu | Esperar 5 min: o watchdog reinicia sozinho |
| Envio funciona, nada é recebido | Webhook no endereço antigo | **Reaplicar webhook** |
| Falha só no envio de imagem | Conexão instável | Celular no carregador e só no WiFi |
| Estado diz conectado mas não envia | Socket morto, estado é cache | **Testar Conexão** confirma, e o watchdog resolve |

Ver o que o supervisor registrou:

```bash
proot-distro login ubuntu -- tail -20 /root/logs/supervisor.log
```

---

## Cuidados que evitam a maioria dos problemas

**Celular no carregador.** Abaixo de uns 30% a economia de bateria do Android
estrangula o processo, e o envio de imagem é o primeiro a falhar, porque precisa
do socket estável por vários segundos, ao contrário do texto.

**Só WiFi, sem alternar com 4G.** Trocar de rádio derruba o WebSocket.

**Nunca use "Exit" na notificação do Termux.** Isso mata tudo. Feche o app
normalmente, o wake lock continua ativo e aparece na barra de notificações.

**Suspensão automática desligada** nas configurações do Android.

E os três ajustes da HyperOS, que valem uma conferida se cair muito:

1. Ajustes › Aplicativos › Gerenciar aplicativos › **Termux** › Economia de bateria › **Sem restrições**
2. Ajustes › Aplicativos › Permissões › **Autostart** › ativar Termux
3. Apps recentes, segurar o Termux, tocar no **cadeado**

---

## Alternativa: rodar no PC

Funciona, com a mesma limitação do celular, mais uma: o PC dorme.

O caminho limpo é o **Docker Desktop** para Windows, que hoje não está instalado
na máquina. Depois de instalar:

```cmd
cd C:\evolution
```

Copie `docker-compose.yml`, `Caddyfile` e crie o `.env` a partir de
`docker/evolution/.env.example` deste repositório, e então:

```cmd
docker compose up -d
```

Como não há domínio apontando para o PC, o Caddy não emite certificado. Nesse
caso remova o serviço `caddy` do compose, publique a porta 8080 do Evolution e
use o `cloudflared` para Windows como túnel, igual ao celular.

Comparando com o celular: o PC tem mais memória e conexão mais estável, mas
desliga e dorme. O celular fica ligado sempre. Para esta operação o celular é o
melhor dos dois, e é onde já está funcionando.

---

## O que resolveria isso de vez

Todo problema recorrente aqui tem a mesma origem: o Evolution mora num aparelho
que o sistema operacional pode suspender, atrás de um túnel com endereço
sorteado.

Uma máquina always on com domínio próprio elimina a categoria inteira: sem túnel,
sem endereço mudando, sem bateria, sem `Reaplicar webhook` toda semana. Uma VPS
de R$30 a R$60 por mês resolve, e o `scripts/evolution-oracle/bootstrap.sh` faz a
instalação inteira em um comando, em qualquer VPS Ubuntu, não só na Oracle.

Não é urgente. Mas quando o cansaço de reconfigurar passar do valor da
mensalidade, é para lá que vale ir.
