#!/data/data/com.termux/files/usr/bin/sh
# Hook do Termux:Boot. Copiar para ~/.termux/boot/evolution e dar chmod +x.
#
# Roda no Termux, fora do Ubuntu. Pega o wake lock antes de entrar no proot,
# senão o Android suspende a CPU e o socket do WhatsApp cai sem o processo morrer.

termux-wake-lock

# O supervisor cuida do Evolution, do túnel e do watchdog do socket
proot-distro login ubuntu -- /root/start-evolution.sh
