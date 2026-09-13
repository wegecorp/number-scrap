#!/usr/bin/env bash
# Setup Cloudflare NAMED tunnel (URL tetap) untuk dashboard number-scrap.
#
# Pakai:
#   sudo bash scripts/named-tunnel.sh lead.namadomain.com
#
# Prasyarat: cloudflared sudah terpasang, dan domain sudah diarahkan
# (nameserver) ke Cloudflare. Script akan minta login sekali (interaktif).
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "pakai: sudo bash scripts/named-tunnel.sh lead.namadomain.com" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${TUNNEL_NAME:-number-scrap}"
CF="${CLOUDFLARED:-/usr/local/bin/cloudflared}"
CFDIR="${HOME}/.cloudflared"

PORT="${PORT:-}"
if [ -z "$PORT" ] && [ -f "$ROOT/.env" ]; then
  PORT="$(grep -m1 '^PORT=' "$ROOT/.env" | cut -d= -f2- || true)"
fi
PORT="${PORT:-3100}"

if [ ! -x "$CF" ]; then
  echo "[tunnel] cloudflared tak ada di $CF" >&2
  echo "[tunnel] install dulu (lihat DEPLOY.md bagian 15)." >&2
  exit 1
fi

echo "[tunnel] domain=$DOMAIN  port=$PORT  nama=$NAME"

if [ ! -f "$CFDIR/cert.pem" ]; then
  echo "[tunnel] belum login — ikuti langkah di browser..."
  "$CF" tunnel login
fi

if ! "$CF" tunnel list | grep -qw "$NAME"; then
  echo "[tunnel] membuat tunnel $NAME"
  "$CF" tunnel create "$NAME"
fi

UUID="$("$CF" tunnel list | awk -v n="$NAME" '$1 == n { print $2; exit }')"
if [ -z "$UUID" ]; then
  echo "[tunnel] gagal mendapat UUID tunnel $NAME" >&2
  exit 1
fi
echo "[tunnel] uuid=$UUID"

"$CF" tunnel route dns "$NAME" "$DOMAIN" || true

mkdir -p /etc/cloudflared
cat > /etc/cloudflared/config.yml <<EOF
tunnel: $NAME
credentials-file: $CFDIR/$UUID.json
ingress:
  - hostname: $DOMAIN
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF

cat > /etc/systemd/system/cloudflared-named.service <<EOF
[Unit]
Description=Cloudflare named tunnel ($NAME)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$CF tunnel --config /etc/cloudflared/config.yml run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl disable --now cloudflared-quick 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now cloudflared-named
sleep 2

systemctl --no-pager status cloudflared-named | head -12
echo
echo "Selesai. Buka: https://$DOMAIN"
echo "Cek        : curl -sI https://$DOMAIN | head -1   # harus 401"
