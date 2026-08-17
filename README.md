# Video Post App

Stok video → jadwal rotasi otomatis → kirim ke Buffer → pantau insight.
Untuk brand **Arachynana** (Sale Pisang Granola), 6 channel lewat 2 akun Buffer gratis.

## Ide dasarnya

Kamu menyetok ~10 video. Aplikasi menyebarnya dengan **pola rotasi**, sehingga:
- setiap hari, tiap platform menayangkan video yang **berbeda-beda**
- satu video mampir ke tiap platform di **hari yang berlainan**

```
           Sen  Sel  Rab  Kam  Jum  Sab
TikTok      V1   V2   V3   V4   V5   V6
Instagram   V2   V3   V4   V5   V6   V1
YouTube     V3   V4   V5   V6   V1   V2
Facebook    V4   V5   V6   V1   V2   V3
Threads     V5   V6   V1   V2   V3   V4
Pinterest   V6   V1   V2   V3   V4   V5
```

Aturannya satu baris, ada di `lib/rotation.js`:
`videoIndex = (dayIndex + channelIndex * offsetStep) % jumlahVideo`

## Halaman

| Halaman | Isi |
|---|---|
| **Stok Video** | Upload batch, isi judul, minta saran judul SEO dari AI, atur urutan (urutan = V1..Vn) |
| **Jadwal** | Pilih video & channel → pratinjau tabel rotasi → simpan → generate caption → kirim per item |
| **Hashtag** | Set hashtag bernama, bisa dibatasi per platform, plus saran dari AI |
| **Insight** | Performa per konten, perbandingan platform, performa set hashtag |
| **Riwayat** | Pengiriman yang sudah jalan + tombol ulangi per item yang gagal |

Sidebar di desktop, bottom-nav di HP.

## Struktur

```
server.js              bootstrap: static + wiring route
lib/
  store.js             baca/tulis JSON di DATA_DIR
  buffer.js            klien Buffer GraphQL + penjaga rate limit
  ai.js                panggilan Hermes (caption, judul SEO, saran hashtag)
  rotation.js          algoritma rotasi + konversi zona waktu
  compose.js           penyusun teks akhir per platform
  http.js              helper route
routes/                videos, channels, hashtags, plan, history, insights
scripts/probe-buffer.js  cek kemampuan API Buffer dengan token asli
test/rotation.test.js    unit test rotasi & zona waktu
public/
  index.html           kerangka (sidebar + bottom-nav)
  css/base.css         token warna & layout responsif
  css/components.css   komponen
  js/config.js         batas karakter, warna platform, menu
  js/router.js         router hash
  js/pages/*.js        satu file per halaman
```

Frontend ES modules vanilla — **tanpa build step**. Edit file, refresh browser.

## Menjalankan

```
npm install
cp .env.example .env     # isi token asli
npm start                # buka http://localhost:3000
npm test                 # unit test rotasi
```

## Langkah pertama setelah punya token Buffer

```
node scripts/probe-buffer.js
```

Script ini menembak API Buffer (~6 request per token) dan menjawab hal yang tidak bisa
dijawab dari dokumentasi:
- apakah paket **Free** benar-benar mengembalikan angka **metrics** (penentu halaman Insight)
- apakah ada mode **publish sekarang** yang tidak terdokumentasi
- apakah `CreatePostInput` punya field **judul/link** khusus
- apakah tipe `Channel` menyimpan jumlah **follower**
- daftar channel & antrian yang sedang berjalan

Hasilnya disimpan ke `probe-result.json` (tidak ikut ke git).

## Endpoint

Endpoint lama tetap ada dengan kontrak yang sama:
`POST /api/upload` · `GET /api/channels` · `POST /api/caption` · `POST /api/publish`

Tambahan:

| Endpoint | Guna |
|---|---|
| `GET/PATCH/DELETE /api/videos[/:id]` | stok video |
| `POST /api/videos/reorder` | ubah urutan (menentukan rotasi) |
| `POST /api/videos/:id/suggest-title` | saran judul SEO |
| `GET /api/channels/detail` | channel + asal data + masalahnya kalau kosong |
| `GET /api/queue` | antrian asli dari Buffer |
| `GET /api/usage` | pemakaian kuota API hari ini |
| `GET/POST/PATCH/DELETE /api/hashtags[/:id]` | set hashtag |
| `POST /api/hashtags/suggest` | saran hashtag dari AI |
| `POST /api/plan/preview` | hitung rotasi tanpa menyimpan |
| `POST /api/plan` · `GET /api/plan[/:id]` · `DELETE /api/plan/:id` | jadwal |
| `POST /api/plan/:id/caption/:videoId` | generate caption satu video |
| `POST /api/plan/:id/send/:index` | kirim satu item (dipakai juga untuk retry) |
| `GET /api/plan/:id/text/:index` | teks final sebelum dikirim |
| `GET /api/insights` | metrics (di-cache) |

## Batasan Buffer yang membentuk desain ini

- **Rate limit paket Free: 100 / 15 menit, 250 / 24 jam, 3.000 / 30 hari.**
  10 video × 6 channel = 60 request sekali kirim. Pemakaian dihitung di
  `buffer-usage.json` dan ditampilkan di sidebar; kalau mepet, request ditolak
  lebih awal supaya tidak terkunci di tengah pengiriman.
- **Antrian maksimal 10 post per channel.** Dicek dari antrian asli sebelum kirim.
- **Tidak ada mode "publish sekarang"** yang terdokumentasi. Yang dipakai
  `customScheduled` + `dueAt`. Kalau probe menemukan `shareNow`, ganti di `lib/buffer.js`.
- **Judul YouTube & judul/link Pinterest digabung ke teks caption**, karena
  `createPost` menerima satu string. Lihat `lib/compose.js`.

## Setelan

| Tempat | Isi |
|---|---|
| `.env` | token, URL, `TIMEZONE`, `DATA_DIR`, batas rate limit, TTL cache metrics |
| `public/js/config.js` | batas karakter per platform, warna platform, menu |
| `lib/rotation.js` | `QUEUE_LIMIT`, jam tayang bawaan per channel |
| `lib/compose.js` | platform mana yang pakai hashtag / punya judul |
| Halaman Hashtag | set hashtag (dulu hardcoded, sekarang dari web) |

## Catatan deploy (Coolify)

- `MEDIA_DIR` harus sama dengan mount path volume, kalau tidak file hilang tiap redeploy
- `DATA_DIR` default `<MEDIA_DIR>/_data`, jadi riwayat & jadwal ikut selamat
- `PUBLIC_BASE_URL` harus domain ber-SSL — Buffer mengambil video dari URL ini
- Tambahkan cronjob pembersih file lama di folder media
