# Video Post App

Upload video → generate caption per platform via Hermes → publish ke semua channel via Buffer API.

## Struktur
- `server.js` — backend (upload, caption, publish)
- `public/index.html` — halaman frontend
- `channels.json` — daftar channel Buffer kamu & akun mana yang dipakai (A/B)
- `.env.example` — contoh environment variables

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
- `MEDIA_DIR` di `.env` HARUS sama dengan mount path volume di Coolify, kalau tidak file akan hilang setiap redeploy
- `PUBLIC_BASE_URL` harus domain yang sudah aktif SSL-nya (Coolify otomatis kasih HTTPS lewat Let's Encrypt)
- Ingat tambahkan cronjob pembersihan file lama di folder media (lihat planning doc terpisah)
