# number-scrap

Scraper lead tim/klub olahraga Indonesia. Cari akun & kontak publik, nilai pakai AI, lalu susun pesan siap kirim. **Kirim tetap manual lewat link `wa.me`** (tanpa bot WhatsApp, tanpa risiko ban).

## Alur

```
keyword -> AI expand -> discovery -> enrich -> AI skor -> draft pesan -> klik Chat (wa.me) -> mark
```

## Fitur

- **Discovery**: Google/DuckDuckGo (`site:instagram.com`), Google Maps Places, halaman kontak website, tim peserta dari tag akun turnamen, plus **AI seed expansion** (cari lebih dalam dari satu keyword).
- **Enrich**: baca bio, resolve link-in-bio (linktree/lynk.id/shortlink), crawl halaman kontak. Nomor dinormalisasi ke E.164.
- **Kualifikasi AI**: skor 0-100 + alasan + segmentasi (`ssb`/`klub`/`akademi`/`turnamen`).
- **Click-to-chat**: export/dashboard berisi link `wa.me` dengan pesan sudah terisi.
- **DNC list**: nomor yang di-suppress tidak akan dihubungi lagi.

## Setup

```bash
npm install
Copy-Item .env.example .env   # lalu isi key
npm run cli -- models         # cari AI_MODEL yang benar
npm run cli -- ping-ai        # pastikan koneksi AI jalan
npm run cli -- stats
```

### Sidecar Instagram (instagrapi)

Endpoint web IG sering balas **429**. Sidecar Python memakai private API (via `sessionid`, tanpa password) sehingga tetap bisa baca bio/link-in-bio.

```bash
python -m venv ig/venv
ig/venv/Scripts/pip install instagrapi          # Windows
# VPS/Linux: ig/venv/bin/pip install instagrapi

ig/venv/Scripts/python ig/ig_check.py ssbsetiabandung   # verifikasi
```

Set di `.env`:
- `IG_SESSIONID` — cookie `sessionid` akun IG burner
- `IG_BACKEND=auto` — instagrapi dulu, fallback ke web
- `PYTHON_BIN` — `ig/venv/Scripts/python.exe` (Windows) / `ig/venv/bin/python` (VPS)
- `IG_PROXY_URL` — opsional, kalau IP kena limit

### Env penting

| Variabel | Fungsi |
|---|---|
| `OFFER` | produk/jasa yang kamu jual (menentukan skor AI + isi pesan) |
| `IG_SESSIONID` | cookie IG burner; tanpa ini profil IG balas 429 |
| `IG_BACKEND` | `auto` (instagrapi→web) / `instagrapi` / `web` |
| `PYTHON_BIN` | python venv untuk sidecar instagrapi |
| `IG_FETCH_DELAY_MS` | jeda antar-fetch profil IG (naikkan kalau kena limit) |
| `OSM_ENABLED` | OpenStreetMap/Nominatim — gratis tanpa key (hasil tipis, bonus) |
| `GOOGLE_MAPS_API_KEY` | Places API (New) — opsional, butuh kartu kredit |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | endpoint AI (OpenAI-compatible, mis. sumopod) |
| `AI_JSON_MODE` | `auto` (aman) / `on` / `off` |
| `DASH_USER`, `DASH_PASS` | basic auth dashboard — **wajib saat online** |
| `MIN_SCORE` | ambang lead dianggap layak |

## Perintah

`keywords.example.txt` berisi contoh daftar keyword (satu intent per baris). Untuk daftar asli, buat `keywords.txt` (gitignored).

```bash
npm run cli -- models                  # daftar model AI tersedia
npm run cli -- ping-ai                 # cek koneksi AI + mode JSON
npm run cli -- expand "<intent>"       # lihat hasil AI expand
npm run cli -- discover "SSB Bandung" [--limit N]   # cari + enrich + simpan
npm run cli -- discover --file keywords.txt [--limit N]   # banyak keyword sekaligus
npm run cli -- score                   # skor AI
npm run cli -- draft                   # susun pesan
npm run cli -- contacts                # lead siap dihubungi + link wa.me
npm run cli -- mark <id...>            # tandai sudah dihubungi
npm run cli -- suppress <nomor>        # masukkan ke DNC
npm run cli -- export [file] [--new]   # export CSV
npm run cli -- stats

npm run serve   # dashboard http://localhost:3000
npm run selftest
```

## Stack

Node 24 + TypeScript, `node:sqlite` (nol native dep), Express + HTMX, `libphonenumber-js`. Sidecar Python (instagrapi) untuk baca profil IG. Tanpa ORM.

Deploy ke VPS: lihat [DEPLOY.md](DEPLOY.md).

## Catatan

Hanya mengambil data yang **publik** dan relevan bisnis. Hormati ToS platform dan peraturan data pribadi (UU PDP). Hormati permintaan opt-out.
