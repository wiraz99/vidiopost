require('dotenv').config();
const express = require('express');
const path = require('path');

const store = require('./lib/store');
const media = require('./lib/media');
const auth = require('./lib/auth');
const { errorHandler } = require('./lib/http');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

// Di belakang proxy Coolify: tanpa ini req.ip selalu alamat proxy-nya (jadi rem
// percobaan login tidak bisa membedakan siapa pun) dan req.secure selalu false
// (jadi cookie tidak pernah dapat penanda Secure).
app.set('trust proxy', 1);

// ============================================================
//  BAGIAN TERBUKA — tidak butuh login
// ============================================================

/**
 * Media SENGAJA dibiarkan terbuka.
 *
 * Buffer mengunduh video dari URL ini dari luar, tanpa membawa cookie atau
 * kredensial apa pun. Menguncinya berarti setiap pengiriman gagal dengan
 * "Video could not be read from its URL".
 *
 * Yang melindungi media adalah nama filenya yang tidak bisa ditebak, bukan
 * login — lihat penamaan file di routes/videos.js.
 */
app.use('/media', express.static(store.MEDIA_DIR));

// Halaman login butuh gayanya sendiri, jadi CSS ikut terbuka.
// Isinya cuma aturan tampilan, tidak ada data.
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

app.get(['/login', '/login.html'], (req, res) => {
  if (auth.sesiDari(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Pemeriksaan hidup untuk Coolify — sengaja tidak membocorkan apa pun.
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.use(require('./routes/auth'));

// ============================================================
//  PENJAGA — semua di bawah ini wajib punya sesi
// ============================================================

app.use((req, res, next) => {
  const keApi = req.path.startsWith('/api/');

  if (!auth.sudahDiatur()) {
    if (keApi) {
      return res.status(503).json({
        error: 'Kata sandi belum diatur di server. Isi AUTH_PASSWORD lalu deploy ulang.',
        perluSetup: true
      });
    }
    return res.redirect('/login');
  }

  if (auth.sesiDari(req)) return next();

  if (keApi) return res.status(401).json({ error: 'Sesi habis atau belum masuk.', perluLogin: true });
  return res.redirect('/login');
});

// ============================================================
//  BAGIAN TERKUNCI
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

app.use(require('./routes/groups'));    // /api/groups
app.use(require('./routes/videos'));    // /api/upload, /api/videos, /api/caption
app.use(require('./routes/channels'));  // /api/channels, /api/queue, /api/usage
app.use(require('./routes/hashtags'));  // /api/hashtags
app.use(require('./routes/links'));     // /api/links
app.use(require('./routes/plan'));      // /api/plan
app.use(require('./routes/history'));   // /api/publish, /api/history
app.use(require('./routes/insights'));  // /api/insights
app.use(require('./routes/settings'));  // /api/settings
app.use(require('./routes/diagnostics'));// /api/diagnostics

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    dataDir: store.DATA_DIR,
    publicBaseUrl: media.PUBLIC_BASE_URL,
    publicBaseUrlLooksLocal: media.baseUrlLooksLocal(),
    hermes: !!process.env.HERMES_API_URL,
    bufferA: !!process.env.BUFFER_TOKEN_A,
    bufferB: !!process.env.BUFFER_TOKEN_B,
    timezone: process.env.TIMEZONE || 'Asia/Jakarta'
  });
});

// Rute API yang tidak dikenal harus balas JSON, bukan index.html.
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`video-post-app jalan di port ${PORT}`);
  console.log(`  data   : ${store.DATA_DIR}`);
  console.log(`  media  : ${store.MEDIA_DIR}`);

  if (!auth.sudahDiatur()) {
    console.log('');
    console.log('  ============================================================');
    console.log('  APLIKASI TERKUNCI — kata sandi belum diatur.');
    console.log('  Isi AUTH_PASSWORD (boleh juga AUTH_USER) di environment,');
    console.log('  lalu deploy ulang. Tanpa itu tidak ada yang bisa masuk.');
    console.log('  ============================================================');
    console.log('');
  } else {
    console.log('  login  : aktif');
  }
  if (!process.env.BUFFER_TOKEN_A && !process.env.BUFFER_TOKEN_B) {
    console.log('  ⚠️  BUFFER_TOKEN_A/B belum diisi — daftar channel & pengiriman tidak akan jalan');
  }
  if (!process.env.HERMES_API_URL) {
    console.log('  ⚠️  HERMES_API_URL belum diisi — caption & saran judul tidak akan jalan');
  }
});
