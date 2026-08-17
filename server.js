require('dotenv').config();
const express = require('express');
const path = require('path');

const store = require('./lib/store');
const media = require('./lib/media');
const { errorHandler } = require('./lib/http');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

// Video yang diupload harus bisa diakses publik — Buffer mengambilnya dari URL ini.
app.use('/media', express.static(store.MEDIA_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API ----------
app.use(require('./routes/videos'));    // /api/upload, /api/videos, /api/caption
app.use(require('./routes/channels'));  // /api/channels, /api/queue, /api/usage
app.use(require('./routes/hashtags'));  // /api/hashtags
app.use(require('./routes/links'));     // /api/links
app.use(require('./routes/plan'));      // /api/plan
app.use(require('./routes/history'));   // /api/publish, /api/history
app.use(require('./routes/insights'));  // /api/insights
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
  if (!process.env.BUFFER_TOKEN_A && !process.env.BUFFER_TOKEN_B) {
    console.log('  ⚠️  BUFFER_TOKEN_A/B belum diisi — daftar channel & pengiriman tidak akan jalan');
  }
  if (!process.env.HERMES_API_URL) {
    console.log('  ⚠️  HERMES_API_URL belum diisi — caption & saran judul tidak akan jalan');
  }
});
