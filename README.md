# Video Post App

Upload video → generate caption per platform via Hermes → publish ke semua channel via Buffer API.

## Struktur
- `server.js` — backend (upload, caption, publish, riwayat, kuota antrian)
- `channels.json` — daftar channel Buffer kamu & akun mana yang dipakai (A/B)
- `.env.example` — contoh environment variables
- `public/`
  - `index.html` — kerangka halaman
  - `css/styles.css` — semua styling
  - `js/config.js` — **file yang paling sering kamu ubah**: batas karakter per platform, bank hashtag, batas antrian
  - `js/api.js` — pembungkus panggilan ke endpoint server
  - `js/state.js` — state aplikasi (channel, antrian, daftar kartu video)
  - `js/card.js` — kartu per video (upload, caption, pilih channel, publish, retry)
  - `js/preview.js` — preview caption bergaya tiap platform
  - `js/queuebar.js` — indikator sisa antrian per channel
  - `js/history.js` — panel riwayat publish
  - `js/app.js` — perekat semuanya (drag & drop, boot)

Frontend memakai ES modules vanilla — tanpa build step, tanpa framework. Edit file, refresh browser.

## Endpoint
Lama (tidak diubah):
- `POST /api/upload` — satu video per request; upload batch = beberapa request paralel dari browser
- `GET /api/channels`
- `POST /api/caption`
- `POST /api/publish`

Baru:
- `GET /api/history?limit=100` — daftar riwayat publish (terbaru dulu)
- `POST /api/history` — simpan hasil publish satu video
- `POST /api/history/:id/result` — update hasil satu channel setelah Retry
- `GET /api/queue` — `{ limit, counts }` hitungan antrian per channel
- `POST /api/queue` — set/geser hitungan antrian satu channel (dipakai tombol "sinkron")

Riwayat & hitungan antrian disimpan sebagai JSON biasa di `DATA_DIR`
(default `<MEDIA_DIR>/_data`), bukan database.

## Cara ganti setelan yang sering berubah
Semua ada di `public/js/config.js`:
- `PLATFORM_LIMITS` — batas karakter per platform (`soft` = kuning, `hard` = merah)
- `HASHTAG_BANK` — daftar hashtag brand; `default: true` = otomatis dicentang
- `PLATFORM_HASHTAGS` — hashtag ekstra khusus platform (mis. `#fyp` di TikTok)
- `HASHTAG_PLATFORMS` — platform mana yang pakai hashtag (Pinterest & YouTube sengaja tidak)
- `QUEUE_LIMIT` — batas antrian Buffer per channel

## Langkah Lokal (opsional, buat coba dulu sebelum deploy)
```
npm install
cp .env.example .env
# isi .env dengan token/URL asli
npm start
```
Buka `http://localhost:3000`

## Sebelum Deploy ke Coolify
1. **Isi `channels.json`** dengan channelId asli dari akun Buffer kamu (bisa dilihat lewat Buffer API Explorer atau dashboard Buffer → channel settings)
2. **Push semua file ini ke repo GitHub baru**
3. Ikuti langkah Coolify:
   - New Resource → Application → connect ke repo ini
   - Tambahkan Persistent Volume, mount ke `/app/media`
   - Isi Environment Variables (isi dari `.env.example`, dengan nilai asli)
   - Set domain/subdomain
   - Deploy

## Catatan
- **Judul YouTube & judul/link Pinterest** saat ini digabung ke dalam teks caption
  (judul di baris pertama, link di baris terakhir), karena `/api/publish` hanya
  menerima satu string per channel. Kalau nanti mau dikirim sebagai field asli
  Buffer, `/api/publish` perlu ditambah parameter — lihat `composeText()` di `public/js/utils.js`.
- **Hitungan antrian bersifat lokal**: naik tiap publish sukses lewat app ini, dan
  tidak otomatis turun saat post benar-benar tayang di Buffer. Pakai tombol
  "sinkron" di tiap kartu channel untuk menyamakan angkanya dengan dashboard Buffer.
- `MEDIA_DIR` di `.env` HARUS sama dengan mount path volume di Coolify, kalau tidak file akan hilang setiap redeploy
- `PUBLIC_BASE_URL` harus domain yang sudah aktif SSL-nya (Coolify otomatis kasih HTTPS lewat Let's Encrypt)
- Ingat tambahkan cronjob pembersihan file lama di folder media (lihat planning doc terpisah)
