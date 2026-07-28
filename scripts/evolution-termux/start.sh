#!/bin/bash
# Supervisor do Evolution API no Termux (dentro do Ubuntu em proot).
#
# Resolve os dois modos de falha, que são diferentes:
#
#   1. O processo morre        → o Android mata sob pressão de memória.
#                                Um laço de reinício resolve.
#
#   2. O socket do WhatsApp    → o processo continua vivo, mas o WebSocket do
#      morre sem o processo      Baileys caiu. O connectionState segue dizendo
#      morrer                    'open' porque é cache, e todo envio falha com
#                                "Connection Closed" / HTTP 428. Um supervisor
#                                comum não percebe: é o watchdog que mata o
#                                processo de propósito para forçar reconexão.
#
# Uso manual:
#   proot-distro login ubuntu -- /root/start-evolution.sh
#
# No boot, via Termux:Boot: ver docs/evolution-api-termux.md, Parte 6.

set -u

EVO_DIR="${EVO_DIR:-/root/evolution-api}"
LOG_DIR="${LOG_DIR:-/root/logs}"
PORT="${PORT:-8080}"
INSTANCE="${INSTANCE:-compras-meridiana}"

# Nome do túnel nomeado do Cloudflare. Vazio usa o túnel rápido, cujo endereço
# muda a cada início e obriga a atualizar a URL base no Fluxo mais o webhook.
TUNNEL_NAME="${TUNNEL_NAME:-}"

# Intervalo do watchdog, em segundos
CHECK_EVERY="${CHECK_EVERY:-300}"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_DIR/supervisor.log"
}

# A apikey sai do .env para não ficar escrita no script
api_key() {
  grep -m1 '^AUTHENTICATION_API_KEY=' "$EVO_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r'
}

# ── 1. Evolution, com reinício automático ────────────────────────────────────
run_evolution() {
  while true; do
    log "subindo evolution"
    ( cd "$EVO_DIR" && npm run start:prod >> "$LOG_DIR/evolution.log" 2>&1 )
    log "evolution saiu, reiniciando em 10s"
    sleep 10
  done
}

# ── 2. Túnel, com reinício automático ────────────────────────────────────────
run_tunnel() {
  while true; do
    if [ -n "$TUNNEL_NAME" ]; then
      log "subindo tunel nomeado $TUNNEL_NAME"
      cloudflared tunnel run "$TUNNEL_NAME" >> "$LOG_DIR/tunnel.log" 2>&1
    else
      log "subindo tunel rapido (endereco vai mudar)"
      cloudflared tunnel --url "http://localhost:$PORT" >> "$LOG_DIR/tunnel.log" 2>&1
    fi
    log "tunel saiu, reiniciando em 10s"
    sleep 10
  done
}

# ── 3. Watchdog do socket ────────────────────────────────────────────────────
# Consulta o próprio número pareado da instância. Exige socket vivo e não envia
# mensagem nenhuma. Resposta diferente de 200 significa socket caído.
run_watchdog() {
  local key owner code
  # Espera o Evolution subir antes da primeira checagem
  sleep 60

  while true; do
    key="$(api_key)"

    if [ -z "$key" ]; then
      log "watchdog: AUTHENTICATION_API_KEY nao encontrada em $EVO_DIR/.env"
      sleep "$CHECK_EVERY"
      continue
    fi

    owner="$(curl -s -m 15 -H "apikey: $key" \
      "http://localhost:$PORT/instance/fetchInstances" \
      | grep -o '"ownerJid":"[0-9]\+' | head -1 | cut -d'"' -f4)"

    if [ -z "$owner" ]; then
      # Sem número pareado: a instância nunca conectou ou foi desvinculada.
      # Reiniciar não resolve, precisa ler o QR Code.
      log "watchdog: instancia sem numero pareado, leia o QR Code"
      sleep "$CHECK_EVERY"
      continue
    fi

    code="$(curl -s -m 25 -o /dev/null -w '%{http_code}' -X POST \
      -H "apikey: $key" -H 'Content-Type: application/json' \
      -d "{\"numbers\":[\"$owner\"]}" \
      "http://localhost:$PORT/chat/whatsappNumbers/$INSTANCE")"

    if [ "$code" != "200" ]; then
      log "watchdog: socket morto (HTTP $code), matando evolution para forcar reconexao"
      pkill -f 'node dist/main'
    fi

    sleep "$CHECK_EVERY"
  done
}

log "===== supervisor iniciado ====="
run_evolution &
run_tunnel &
run_watchdog &
wait
