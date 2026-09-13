# Panduan Deploy VPS

Target: Ubuntu 22.04/24.04, 1 vCPU / 1 GB RAM cukup. Node **24** wajib (`node:sqlite`).

```
internet ──▶ Caddy (HTTPS) ──▶ dashboard :3000   (basic auth)
                                  │
                                  ├─ data/app.db      (SQLite)
                                  ├─ ig/venv          (sidecar instagrapi)
                                  └─ systemd timer    (discover harian)
```

## 1. Paket dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential python3-venv ufw
sudo timedatectl set-timezone Asia/Jakarta
```

## 2. Node 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # harus v24.x
```

## 3. Ambil kode

```bash
sudo mkdir -p /opt && sudo chown "$USER" /opt
git clone https://github.com/wegecorp/number-scrap.git /opt/number-scrap
cd /opt/number-scrap
npm ci
```

`tsx` ada di dependencies, jadi `NODE_ENV=production` pun aman.

## 4. Sidecar Instagram (Python)

```bash
cd /opt/number-scrap
python3 -m venv ig/venv
ig/venv/bin/pip install -r ig/requirements.txt
```

## 5. `.env` di server

```bash
cp .env.example .env
nano .env
```

Isi minimal:
```
OFFER=konveksi jersey olahraga custom (...)
AI_API_KEY=...
AI_BASE_URL=https://ai.sumopod.com/v1
AI_MODEL=deepseek-v4-flash
IG_SESSIONID=...
IG_BACKEND=auto
PYTHON_BIN=ig/venv/bin/python
DASH_USER=admin
DASH_PASS=<password-kuat>
PORT=3000
HOST=127.0.0.1
```
`PYTHON_BIN` di Linux wajib `ig/venv/bin/python` (default di kode untuk Windows).

## 6. Session IG harus dibuat dari IP server

Jangan langsung pakai `session.json` dari laptop (IP beda → rawan challenge). Login sekali dari server:

```bash
cd /opt/number-scrap
ig/venv/bin/python ig/ig_check.py ssbsetiabandung
```

Harapan: keluar JSON profil. Kalau `challenge_required` → akun butuh verifikasi; lihat bagian **Proxy** di bawah.

## 7. Dashboard sebagai service (systemd)

Pastikan path npm (biasanya `/usr/bin/npm`):
```bash
which npm   # kalau beda, sesuaikan ExecStart di unit bawah
```

```bash
sudo tee /etc/systemd/system/number-scrap-web.service >/dev/null <<'EOF'
[Unit]
Description=number-scrap dashboard
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/number-scrap
ExecStart=/usr/bin/npm run --silent serve
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF
```

> Pakai `User=` sesuai akunmu. Kalau login sebagai **root**, ganti jadi `User=root` (atau hapus baris `User=`). Jangan biarkan `User=%i` — itu placeholder template, unit biasa akan gagal.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now number-scrap-web
sudo systemctl status number-scrap-web --no-pager
journalctl -u number-scrap-web -n 30 --no-pager   # kalau gagal, lihat log ini
```

## 8. Job harian (systemd timer)

`keywords.txt` di `/opt/number-scrap` (satu intent per baris).

```bash
sudo tee /etc/systemd/system/number-scrap-daily.service >/dev/null <<'EOF'
[Unit]
Description=number-scrap daily discovery

[Service]
Type=oneshot
WorkingDirectory=/opt/number-scrap
Environment=KEYWORDS=keywords.txt
Environment=LIMIT=20
ExecStart=/usr/bin/bash scripts/daily.sh
User=ubuntu
# sesuaikan User= dengan akunmu (login root -> User=root)
EOF

sudo tee /etc/systemd/system/number-scrap-daily.timer >/dev/null <<'EOF'
[Unit]
Description=Jalankan discovery tiap hari 08:00

[Timer]
OnCalendar=*-*-* 08:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now number-scrap-daily.timer
systemctl list-timers | grep number-scrap
```

## 9. HTTPS + akses aman

**Wajib**: dashboard memuat nomor HP. Pilih salah satu.

### Caddy (auto HTTPS, butuh domain)
```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
lead.contoh.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```
> Angka `3000` harus **sama** dengan `PORT` di `.env`. Cek port aslinya: `journalctl -u number-scrap-web | grep dashboard`.
> Basic auth dari app sudah aktif (`DASH_USER`/`DASH_PASS`).

### Tanpa domain (SSH tunnel / Tailscale)
Lewat SSH tunnel, dashboard tidak perlu dibuka ke publik:
```bash
# dari laptop:
ssh -L 3000:127.0.0.1:3000 user@IP_VPS
# buka http://localhost:3000
```
Jangan buka port 3000 ke internet langsung.

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw status
```

## 11. Opsional: self-host SearXNG (search andal, gratis)

Kalau instance publik sering kena limit:
```bash
sudo apt install -y docker.io docker-compose-plugin
sudo mkdir -p /opt/searxng && cd /opt/searxng
# buat config minimal lalu:
# docker run -d --name searxng -p 127.0.0.1:8080:8080 searxng/searxng
```
Lalu di `.env`:
```
SEARCH_PROVIDER=auto
SEARXNG_URLS=http://127.0.0.1:8080
```
(Bisa gabung: instance lokal dulu, publik sebagai cadangan.)

## 12. Proxy IG (kalau kena 429/challenge)

Kalau IP VPS dibatasi Instagram:
1. Sewa **static residential / ISP** (atau mobile) dengan IP Indonesia.
2. `npm i undici` di `/opt/number-scrap`
3. `.env`: `IG_PROXY_URL=http://user:pass@host:port`
4. Ulangi langkah 6 (`ig_check`) supaya session dibuat dari IP proxy.

Aturan: 1 IP untuk 1 akun IG, jangan rotating.

## 13. Backup

Database cuma satu file:
```bash
# backup harian
sudo crontab -e
# 0 3 * * * cp /opt/number-scrap/data/app.db /opt/backup/app-$(date +\%F).db
```
Jangan commit `.env` atau `ig/session.json` ke git (sudah gitignored).

## 14. Update

```bash
cd /opt/number-scrap
git pull
npm ci
ig/venv/bin/pip install -r ig/requirements.txt
sudo systemctl restart number-scrap-web
```

## 15. Akses dari HP tanpa domain

Dashboard bind ke `127.0.0.1`, jadi harus lewat terowongan. **Jangan** buka port 3100 langsung ke internet (tanpa TLS). Pilih salah satu:

### Opsi A — Tailscale (privat, tidak dibuka ke internet) — disarankan

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up          # login, tautkan akun
tailscale serve --bg 3100  # proxy tailnet -> 127.0.0.1:3100
tailscale serve status
```
Di HP: install app **Tailscale**, login akun yang sama, lalu buka:
```
https://<nama-vps>.<tailnet>.ts.net
```
HTTPS otomatis, tidak terlihat publik, tidak perlu buka firewall. Dashboard tetap minta basic auth.

### Opsi B — Cloudflare Tunnel (URL publik instan, tanpa akun/domain)

```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version

# uji manual (Ctrl+C untuk stop)
PORT=3100 bash scripts/tunnel.sh
```
Muncul URL `https://xxxx.trycloudflare.com` → buka di HP. URL **berubah tiap restart**.

Jadikan service supaya hidup terus:
```bash
sudo tee /etc/systemd/system/cloudflared-quick.service >/dev/null <<'EOF'
[Unit]
Description=Cloudflare quick tunnel untuk number-scrap
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/number-scrap
Environment=PORT=3100
ExecStart=/usr/bin/bash scripts/tunnel.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-quick
```

Ambil URL publiknya (ini yang dibuka di HP):
```bash
journalctl -u cloudflared-quick -n 50 --no-pager | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

> Ini **membuka dashboard ke internet**. `DASH_PASS` wajib kuat (>=12 karakter, cek `npm run cli -- doctor`).
> Stop kapan saja: `sudo systemctl stop cloudflared-quick`.

### Yang tidak disarankan
```bash
ufw allow 3100        # jangan — HTTP polos, dasar, rawan
```

## 16. Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| `systemctl status` → `Failed to determine user` | baris `User=%i` belum diganti. Set `User=root` atau `User=ubuntu`. |
| `status=217/USER` | user di `User=` tak ada. Cek `id ubuntu`. |
| `EADDRINUSE :3000` | port dipakai. `ss -ltnp \| grep 3000`, lalu ganti `PORT` di `.env` atau hentikan proses itu. |
| `curl :3000` balas **200** padahal harusnya **401** | itu **bukan** app kita — ada proses lain di port itu. Cek `ss -ltnp \| grep 3000` dan bandingkan port yang dipakai service (`journalctl -u number-scrap-web` cetak `dashboard: http://127.0.0.1:<PORT>`). Rapikan `PORT` di `.env` supaya cocok dengan Caddy. |
| dashboard 502 dari Caddy | app tidak jalan / bind beda. Pastikan `HOST=127.0.0.1`, cek `journalctl -u number-scrap-web -n 50`. |
| `EACCES` menulis `data/app.db` | folder milik user lain. `sudo chown -R $USER /opt/number-scrap/data`. |
| `npm: not found` di systemd | npm tak di `/usr/bin`. Cek `which npm`, sesuaikan `ExecStart`. |
| `LoginRequired` / `TooManyRedirects` saat `ig_check` | `IG_SESSIONID` kedaluwarsa → ambil ulang cookie (lihat bagian 6). |
| Dialog basic auth muncul terus / "ga kebuka" | kredensial salah atau cache browser. Verifikasi di server: `curl -sI -u "$U:$P" http://127.0.0.1:$PORT` harus `200`. Buka URL tunnel di **incognito**. Pastikan `DASH_USER` (jangan asumsi "admin"). Password `openssl rand` susah diketik → set ulang yang mudah diingat tapi kuat. |
| `challenge_required` | akun perlu verifikasi di browser, atau IP VPS dicurigai → pakai proxy (bagian 12). |
| timer jalan tapi tidak ada lead baru | cek `journalctl -u number-scrap-daily -n 50`; pastikan `keywords.txt` ada di `/opt/number-scrap`. |

Log penting:
```bash
journalctl -u number-scrap-web -f
journalctl -u number-scrap-daily -n 100 --no-pager
```

## Cek cepat setelah deploy

```bash
node -v                                  # v24
systemctl is-active number-scrap-web     # active
npm run cli -- doctor                     # cek menyeluruh (node, AI, IG, python, auth)

# ambil PORT + kredensial dari .env (jangan tulis password literal)
PORT=$(grep -m1 '^PORT=' .env | cut -d= -f2-)
U=$(grep -m1 '^DASH_USER=' .env | cut -d= -f2-)
P=$(grep -m1 '^DASH_PASS=' .env | cut -d= -f2-)

curl -sI "http://127.0.0.1:$PORT" | head -1              # 401 (belum auth)
curl -sI -u "$U:$P" "http://127.0.0.1:$PORT" | head -1   # 200 (auth benar)

ig/venv/bin/python ig/ig_check.py <akun> # data profil keluar
npm run cli -- stats
```

> Port dashboard **tidak harus 3000**. Kalau 3000 dipakai app lain (mis. PM2), biarkan; cukup pastikan `PORT` di `.env` = angka yang dipakai `reverse_proxy` di Caddy.
