#!/usr/bin/env bash
# Cloudflare quick tunnel -> dashboard lokal. Dipakai systemd / manual.
# URL publik muncul di log: journalctl -u cloudflared-quick | grep trycloudflare
set -euo pipefail

PORT="${PORT:-3100}"
CLOUDFLARED="${CLOUDFLARED:-/usr/local/bin/cloudflared}"

if [ ! -x "$CLOUDFLARED" ]; then
  echo "[tunnel] cloudflared tak ditemukan di $CLOUDFLARED" >&2
  echo "[tunnel] install dulu (lihat DEPLOY.md bagian 15)." >&2
  exit 1
fi

echo "[tunnel] mulai -> http://127.0.0.1:${PORT}"
exec "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}"
