#!/bin/bash
# Instala o Evolution API em uma VM Ubuntu limpa, pronta para o Fluxo.
#
# Feito para o Oracle Cloud Always Free (VM.Standard.A1.Flex, ARM), mas funciona
# em qualquer VPS Ubuntu. A imagem do Evolution tem build linux/arm64, então o
# mesmo compose serve nas duas arquiteturas.
#
# Uso, na VM, como usuário com sudo (na Oracle é o 'ubuntu'):
#
#   curl -fsSL https://raw.githubusercontent.com/maxlyfe/fluxo-inventory-multi-hotel/main/scripts/evolution-oracle/bootstrap.sh -o bootstrap.sh
#   EVOLUTION_DOMAIN=evolution.seudominio.com.br ACME_EMAIL=voce@empresa.com bash bootstrap.sh
#
# Sem as variáveis, ele pergunta.

set -euo pipefail

DEST="${DEST:-/opt/evolution}"
REPO_RAW="https://raw.githubusercontent.com/maxlyfe/fluxo-inventory-multi-hotel/main/docker/evolution"

msg()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Rode como usuário normal com sudo, não como root. Na Oracle é o usuário 'ubuntu'."
sudo -n true 2>/dev/null || sudo true || die "Este usuário precisa de sudo."

# ── 1. Domínio e e-mail ──────────────────────────────────────────────────────
if [ -z "${EVOLUTION_DOMAIN:-}" ]; then
  read -rp "Domínio que aponta para esta VM (ex: evolution.seudominio.com.br): " EVOLUTION_DOMAIN
fi
if [ -z "${ACME_EMAIL:-}" ]; then
  read -rp "E-mail para avisos do certificado Let's Encrypt: " ACME_EMAIL
fi

[ -n "$EVOLUTION_DOMAIN" ] || die "Domínio é obrigatório."
[ -n "$ACME_EMAIL" ] || die "E-mail é obrigatório."

# ── 1b. Modo micro, para VM de 1 GB ──────────────────────────────────────────
# No E2.1.Micro da Oracle (1 GB) o stack completo não cabe: só Postgres e Redis
# locais consumiriam metade da memória. Nesse caso usamos o Postgres do Supabase
# e dispensamos o Redis, cabendo uma instância do WhatsApp.
RAM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
COMPOSE_FILE="docker-compose.yml"
MICRO=0

if [ "$RAM_MB" -lt 1900 ]; then
  MICRO=1
  COMPOSE_FILE="docker-compose.micro.yml"
  warn "Detectado ${RAM_MB} MB de RAM. Usando a variante enxuta: Postgres externo, sem Redis."

  if [ -z "${DATABASE_CONNECTION_URI:-}" ] && [ ! -f "$DEST/.env" ]; then
    echo
    echo "    Precisa da string do Postgres. No Supabase: Connect > Direct >"
    echo "    Connection string > escolha o SESSION POOLER (porta 5432)."
    echo "    Acrescente ?schema=evolution_api no final."
    echo
    read -rp "    DATABASE_CONNECTION_URI: " DATABASE_CONNECTION_URI
    [ -n "$DATABASE_CONNECTION_URI" ] || die "String de conexão é obrigatória no modo micro."
  fi
fi

# ── 2. Conferir o DNS antes de tudo ──────────────────────────────────────────
# Sem o DNS resolvendo para esta VM, o Caddy não consegue emitir o certificado e
# o serviço sobe sem HTTPS. Melhor descobrir agora que depois.
msg "Conferindo o DNS de $EVOLUTION_DOMAIN"
IP_PUBLICO="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
IP_DNS="$(getent ahostsv4 "$EVOLUTION_DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || echo '')"

echo "    IP desta VM : ${IP_PUBLICO:-nao detectado}"
echo "    IP do DNS   : ${IP_DNS:-nao resolve}"

if [ -z "$IP_DNS" ]; then
  warn "O domínio ainda não resolve. Crie um registro A apontando para ${IP_PUBLICO:-o IP desta VM} e espere propagar."
  read -rp "    Seguir mesmo assim? (s/N) " R; [ "$R" = "s" ] || exit 1
elif [ -n "$IP_PUBLICO" ] && [ "$IP_DNS" != "$IP_PUBLICO" ]; then
  warn "O domínio resolve para $IP_DNS, diferente desta VM ($IP_PUBLICO)."
  read -rp "    Seguir mesmo assim? (s/N) " R; [ "$R" = "s" ] || exit 1
else
  echo "    DNS conferido."
fi

# ── 3. Docker ────────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  msg "Docker já instalado"
else
  msg "Instalando Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# ── 4. Portas, na camada de dentro da VM ─────────────────────────────────────
# As imagens Ubuntu da Oracle vêm com iptables bloqueando tudo menos SSH. Isso é
# independente da Security List no painel: sem abrir aqui, o Caddy nunca emite o
# certificado e o erro de HTTPS não explica o motivo.
msg "Liberando as portas 80 e 443 no iptables"
for PORTA in 80 443; do
  if sudo iptables -C INPUT -p tcp --dport "$PORTA" -j ACCEPT 2>/dev/null; then
    echo "    porta $PORTA já liberada"
  else
    sudo iptables -I INPUT 1 -p tcp --dport "$PORTA" -j ACCEPT
    echo "    porta $PORTA liberada"
  fi
done

if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent
  sudo netfilter-persistent save
fi

warn "Falta a outra camada: no painel da Oracle, abra 80 e 443 na Security List da subnet."

# ── 5. Arquivos do stack ─────────────────────────────────────────────────────
msg "Baixando o stack para $DEST"
sudo mkdir -p "$DEST"
sudo chown "$USER":"$USER" "$DEST"
cd "$DEST"

curl -fsSL "$REPO_RAW/$COMPOSE_FILE" -o "$COMPOSE_FILE"
curl -fsSL "$REPO_RAW/Caddyfile" -o Caddyfile

# ── 5b. Swap, só no modo micro ───────────────────────────────────────────────
# Com 1 GB o pico de memória do upload de mídia estoura sem swap, e o kernel mata
# o processo do Evolution, derrubando a sessão do WhatsApp.
if [ "$MICRO" -eq 1 ]; then
  if [ -f /swapfile ]; then
    msg "Swap já configurado"
  else
    msg "Criando 2 GB de swap"
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    # Prioriza manter processo em RAM: swap é rede de segurança, não uso rotineiro
    echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-evolution-swap.conf >/dev/null
    sudo sysctl -q -p /etc/sysctl.d/99-evolution-swap.conf
  fi
fi

# ── 6. Segredos ──────────────────────────────────────────────────────────────
# Preserva o .env existente: reexecutar não deve invalidar a instância já
# pareada, o que forçaria ler o QR Code de novo.
if [ -f .env ]; then
  msg ".env já existe, preservando os segredos atuais"
  API_KEY="$(grep -m1 '^EVOLUTION_API_KEY=' .env | cut -d= -f2-)"
else
  msg "Gerando segredos"
  API_KEY="$(openssl rand -hex 32)"
  {
    echo "EVOLUTION_DOMAIN=$EVOLUTION_DOMAIN"
    echo "ACME_EMAIL=$ACME_EMAIL"
    echo "EVOLUTION_API_KEY=$API_KEY"
    if [ "$MICRO" -eq 1 ]; then
      echo "DATABASE_CONNECTION_URI=$DATABASE_CONNECTION_URI"
    else
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    fi
  } > .env
  chmod 600 .env
fi

# ── 7. Subir ─────────────────────────────────────────────────────────────────
msg "Subindo os containers"
sudo docker compose -f "$COMPOSE_FILE" pull
sudo docker compose -f "$COMPOSE_FILE" up -d

msg "Aguardando o Evolution responder"
# A porta 8080 não é publicada no host: só o Caddy alcança o Evolution, pela rede
# interna do compose. Então o teste roda dentro do container, com o node que já
# está na imagem, em vez de curl no localhost do host.
PROBE='require("http").get("http://localhost:8080/",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))'
OK=0
for _ in $(seq 1 30); do
  if sudo docker compose -f "$COMPOSE_FILE" exec -T evolution node -e "$PROBE" >/dev/null 2>&1; then
    OK=1; break
  fi
  sleep 5
done

if [ "$OK" -eq 1 ]; then
  echo "    Evolution respondendo na rede interna."
else
  warn "O Evolution não respondeu em 150s. Veja: sudo docker compose -f $COMPOSE_FILE logs evolution"
fi

msg "Conferindo o HTTPS (o certificado pode levar 1 a 2 minutos)"
for _ in $(seq 1 24); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$EVOLUTION_DOMAIN/" || echo 000)"
  [ "$CODE" = "200" ] && break
  sleep 5
done

cat <<EOF

────────────────────────────────────────────────────────────────
 Pronto. Configure no Fluxo, em Configuracoes > Integracao WhatsApp:

   Provider     : Evolution API
   URL base     : https://$EVOLUTION_DOMAIN
   API Key      : $API_KEY
   Instancia    : um nome por hotel, ex: compras-meridiana

 Salve a configuracao, depois clique em Criar instancia e conectar
 e leia o QR Code no WhatsApp de compras.

 HTTPS agora: ${CODE:-nao testado}   (200 = ok, 000/502 = ver abaixo)

 Se nao respondeu 200:
   1. Security List da subnet no painel da Oracle, portas 80 e 443
   2. O registro A do dominio aponta para ${IP_PUBLICO:-o IP desta VM}
   3. sudo docker compose -f $COMPOSE_FILE logs caddy

 Logs      : cd $DEST && sudo docker compose -f $COMPOSE_FILE logs -f
 Reiniciar : cd $DEST && sudo docker compose -f $COMPOSE_FILE restart
 Backup    : sudo docker compose exec -T postgres pg_dump -U evolution evolution | gzip > evo-\$(date +%F).sql.gz
────────────────────────────────────────────────────────────────

EOF
