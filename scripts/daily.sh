#!/usr/bin/env bash
# Job harian: cari lead -> skor -> susun pesan. Dipanggil systemd timer / cron.
set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${LIMIT:-20}"
KEYWORDS="${KEYWORDS:-keywords.txt}"

echo "[daily] $(date -Is) mulai (limit=$LIMIT, file=$KEYWORDS)"
npm run --silent cli -- discover --file "$KEYWORDS" --limit "$LIMIT"
npm run --silent cli -- score
npm run --silent cli -- draft
npm run --silent cli -- stats
echo "[daily] $(date -Is) selesai"
