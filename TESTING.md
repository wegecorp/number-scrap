# Panduan Setup & Testing Lokal

Semua perintah untuk **PowerShell (Windows)**, dijalankan dari root project.

## 0. Prasyarat

- Node.js **24+** (`node -v`)
- npm

## 1. Install

```powershell
node -v
npm install
Copy-Item .env.example .env
```

## 2. Isi kredensial

Buka `.env`, isi sesuai tabel. Urut prioritas:

### `OFFER`
```
OFFER=konveksi jersey olahraga custom (jersey tim, akademi, komunitas, turnamen)
```
Menentukan cara AI menilai lead dan menyusun pesan. Ubah kalau jualanmu beda.

### AI (sumopod — OpenAI-compatible)
```
AI_BASE_URL=https://ai.sumopod.com/v1
AI_API_KEY=<key dari dashboard sumopod>
AI_MODEL=<lihat langkah 3>
```

### `GOOGLE_MAPS_API_KEY` (opsional — butuh kartu kredit)
Kalau tidak bisa klaim (kartu kredit), **lewati saja**. Sumber nomor pengganti:

| Sumber | Butuh key? | Catatan |
|---|---|---|
| **Bio + link-in-bio IG** | `IG_SESSIONID` | **paling produktif** untuk jersey (banyak admin tulis `wa.me` di bio) |
| **Halaman kontak website** | tidak | otomatis via DuckDuckGo + fetch |
| **OpenStreetMap/Nominatim** | tidak | gratis (`OSM_ENABLED=1`), tapi hasil tipis untuk SSB |
| Google Maps Places | ya | paling rapi, tapi butuh kartu kredit |

Jadi kalau Maps tak tersedia, **prioritas ke IG**: pastikan `IG_SESSIONID` beres.

### `IG_SESSIONID` (wajib untuk baca bio & link-in-bio)
1. Login Instagram pakai **akun burner** di browser
2. F12 → Application → Cookies → `https://www.instagram.com`
3. Cari cookie `sessionid`, copy nilainya ke `.env` (jangan URL-encode)
4. Akun ini berisiko dibatasi — jangan pakai akun utama

### Sidecar Instagram (instagrapi)

Endpoint web IG sering 429. Sidecar Python pakai private API lewat `sessionid`, jadi tetap bisa baca bio/link-in-bio.

```powershell
python -m venv ig/venv
ig/venv/Scripts/pip install instagrapi

# .env
# IG_BACKEND=auto
# PYTHON_BIN=ig/venv/Scripts/python.exe

# verifikasi sebelum run panjang:
ig/venv/Scripts/python ig/ig_check.py ssbsetiabandung
```

Harapan: keluar JSON berisi `full_name`, `biography`, `follower_count`.
- `challenge_required` → akun perlu verifikasi / butuh proxy
- `LoginRequired` → `IG_SESSIONID` kedaluwarsa, ambil ulang

Windows: pakai `ig/venv/Scripts/...`. VPS/Linux: `ig/venv/bin/...` dan set `PYTHON_BIN=ig/venv/bin/python`.

## 3. Cek AI dulu (sebelum run panjang)

```powershell
npm run cli -- models
```
Copy salah satu id ke `AI_MODEL`, lalu:
```powershell
npm run cli -- ping-ai
```
Harapan: `[ping-ai] OK · mode=json_object` (atau `mode=plain` — dua-duanya jalan).

## 4. Tes otomatis (wajib lulus)

```powershell
npm run typecheck
npm run selftest
```
Harapan: typecheck tanpa error, selftest `15 check lulus`.

## 5. Run alur asli

Mulai dari keyword **sempit** (tipe target + kota):

```powershell
npm run cli -- expand "SSB Jakarta Selatan"
npm run cli -- discover "SSB Jakarta Selatan" --limit 10
npm run cli -- stats
npm run cli -- score
npm run cli -- draft
npm run cli -- contacts
npm run cli -- export leads.csv --new
```

Banyak keyword sekaligus: salin `keywords.example.txt` jadi `keywords.txt`, satu intent per baris, lalu:
```powershell
npm run cli -- discover --file keywords.txt --limit 10
```
`--limit` berlaku **per keyword** (batas jumlah profil IG yang di-fetch tiap intent).

Harapan tiap tahap:
| Perintah | Harapan |
|---|---|
| `expand` | `tooBroad=false`, ada kota + tipe target |
| `discover` | `[ig] kandidat akun: N`, `[web] situs dengan kontak`, `tersimpan: N` |
| `stats` | `withPhone` > 0 |
| `score` | `[score] selesai (model: ...)` |
| `draft` | `[draft] pesan disusun: N` |
| `contacts` | daftar lead + link `wa.me` |
| `export` | file `leads.csv` terisi `chat_link` |

## 6. Cek dashboard

```powershell
npm run serve
```
Buka http://localhost:3000:

| Aksi | Harapan |
|---|---|
| Tabel lead | skor berwarna, nomor tampil |
| Tombol **Chat** | buka `wa.me/...?text=...` dengan pesan terisi |
| Tombol **Tandai** | lead pindah keluar dari "Belum dihubungi" |
| Tombol **Susun pesan** | lead berskor tanpa pesan jadi terisi |
| `/export.csv` | kolom `chat_link` + `suggested_message` terisi |

Stop: `Ctrl+C`.

## 7. Reset data

```powershell
Remove-Item -Recurse -Force data
npm run cli -- stats   # leads=0
```

## 8. Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| `[models] gagal: AI 401` | `AI_API_KEY` salah |
| `[ping-ai] gagal` | cek `AI_BASE_URL` (harus berakhiran `/v1`) |
| `IG 429` | `IG_SESSIONID` kosong/kedaluwarsa, atau naikkan `IG_FETCH_DELAY_MS` |
| `[maps] -> 0` | `GOOGLE_MAPS_API_KEY` kosong / Places API (New) belum diaktifkan |
| `duckduckgo 403` | DDG memblokir; set `SEARCH_PROVIDER=google-cse` + isi CSE key/cx |
| `ExperimentalWarning: SQLite` | normal, sudah dimatikan via npm script |
| Dashboard kosong | belum ada lead; jalankan `discover` |
| Port 3000 dipakai | set `PORT=3001` di `.env` |
| AI balas 400 soal `response_format` | set `AI_JSON_MODE=off` |

## 9. Nanti di VPS (belum dilakukan)

Sebelum online, wajib:
1. **Basic auth dashboard** — dashboard memuat nomor HP & belum ada login
2. `systemd` (`Restart=always`) + timer untuk discovery terjadwal
3. Node 24, `TZ=Asia/Jakarta`, DB persisten + backup
4. Akses via domain+HTTPS (Caddy) atau SSH tunnel/Tailscale
5. **Proxy residensial untuk IG** — IP datacenter VPS lebih gampang kena 429
