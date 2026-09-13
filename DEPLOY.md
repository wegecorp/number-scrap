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
User=%i

[Install]
WantedBy=multi-user.target
EOF
```

Ganti `User=%i` dengan user kamu (mis. `User=ubuntu`), lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now number-scrap-web
sudo systemctl status number-scrap-web
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
Basic auth dari app sudah aktif (`DASH_USER`/`DASH_PASS`).

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

## Cek cepat setelah deploy

```bash
node -v                                  # v24
systemctl is-active number-scrap-web     # active
curl -sI http://127.0.0.1:3000 | head -1 # 401 (basic auth aktif)
ig/venv/bin/python ig/ig_check.py <akun> # data profil keluar
npm run cli -- stats
```
