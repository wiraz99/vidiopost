/** Stok video: upload, daftar, edit judul, saran judul SEO, hapus. */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const store = require('../lib/store');
const ai = require('../lib/ai');
const media = require('../lib/media');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, store.MEDIA_DIR),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB

const readVideos = () => store.read('videos', []);
const writeVideos = (v) => store.write('videos', v);

// ---------- upload ----------
// Kontrak lama dipertahankan: response tetap punya { url, filename } di level atas.
// Bedanya sekarang video langsung terdaftar di stok, jadi frontend tidak perlu request kedua.
router.post('/api/upload', upload.single('video'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError('No file uploaded', 400);

  const video = {
    id: store.uid('vid'),
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    title: '',
    brief: '',
    captions: {},
    hashtagSetIds: [],
    status: 'stock',
    createdAt: new Date().toISOString()
  };

  const videos = readVideos();
  videos.unshift(video);
  writeVideos(videos);

  // Kontrak lama dipertahankan: { url, filename } tetap di level atas.
  res.json({ url: media.publicUrl(video.filename), filename: req.file.filename, video: media.decorate(video) });
}));

// ---------- daftar & ubah ----------
router.get('/api/videos', (req, res) => {
  const { status } = req.query;
  const videos = readVideos();
  const list = status ? videos.filter((v) => v.status === status) : videos;
  res.json({ videos: list.map(media.decorate) });
});

// `link` = URL tujuan, dipakai Pinterest (lihat lib/compose.js).
const EDITABLE = ['title', 'brief', 'link', 'linkId', 'captions', 'hashtagSetIds', 'status', 'order'];

router.patch('/api/videos/:id', asyncHandler(async (req, res) => {
  const videos = readVideos();
  const video = videos.find((v) => v.id === req.params.id);
  if (!video) throw new HttpError('Video tidak ditemukan', 404);

  for (const key of EDITABLE) {
    if (req.body[key] !== undefined) video[key] = req.body[key];
  }
  video.updatedAt = new Date().toISOString();
  writeVideos(videos);
  res.json({ video: media.decorate(video) });
}));

router.delete('/api/videos/:id', asyncHandler(async (req, res) => {
  const videos = readVideos();
  const index = videos.findIndex((v) => v.id === req.params.id);
  if (index === -1) throw new HttpError('Video tidak ditemukan', 404);

  const [removed] = videos.splice(index, 1);
  writeVideos(videos);

  // File fisiknya ikut dibuang supaya folder media tidak menumpuk.
  if (req.query.keepFile !== '1' && removed.filename) {
    // Pastikan tetap di dalam MEDIA_DIR — jangan percaya nama file mentah-mentah.
    const base = path.resolve(store.MEDIA_DIR);
    const filePath = path.resolve(base, removed.filename);
    if (filePath.startsWith(base + path.sep)) fs.promises.unlink(filePath).catch(() => {});
  }
  res.json({ ok: true, removed });
}));

/** Ubah urutan video sekaligus — urutan inilah yang dipakai algoritma rotasi. */
router.post('/api/videos/reorder', asyncHandler(async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) throw new HttpError('ids harus array', 400);

  const videos = readVideos();
  const rank = new Map(ids.map((id, i) => [id, i]));
  videos.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  writeVideos(videos);
  res.json({ videos });
}));

// ---------- saran judul SEO ----------
router.post('/api/videos/:id/suggest-title', asyncHandler(async (req, res) => {
  const videos = readVideos();
  const video = videos.find((v) => v.id === req.params.id);
  if (!video) throw new HttpError('Video tidak ditemukan', 404);

  const brief = (req.body?.brief ?? video.brief ?? '').trim();
  if (!brief) throw new HttpError('Isi brief dulu supaya AI tahu isi videonya', 400);

  const titles = await ai.suggestTitles({ brief, count: req.body?.count || 5 });

  video.brief = brief;
  video.titleSuggestions = titles;
  writeVideos(videos);

  res.json({ titles });
}));

/**
 * Cek apakah video benar-benar bisa diunduh dari PUBLIC_BASE_URL.
 *
 * Buffer mengunduh videonya sendiri dari URL itu; kalau gagal, errornya
 * "Invalid post: Video could not be read from its URL." dan baru ketahuan
 * setelah kuota terpakai. Lebih baik dicek lebih dulu.
 */
router.get('/api/media/check', asyncHandler(async (req, res) => {
  const videos = readVideos();
  const video = req.query.id ? videos.find((v) => v.id === req.query.id) : videos[0];

  if (!video) return res.json({ ok: false, reason: 'Belum ada video di stok untuk diuji.' });

  const url = media.publicUrl(video.filename);
  const result = {
    url,
    filename: video.filename,
    adaDiDisk: media.fileExists(video.filename),
    baseUrlTerlihatLokal: media.baseUrlLooksLocal()
  };

  if (!result.adaDiDisk) {
    return res.json({ ...result, ok: false, reason: 'File tidak ada di disk server. Volume penyimpanan kemungkinan tidak ter-mount.' });
  }
  if (result.baseUrlTerlihatLokal) {
    return res.json({ ...result, ok: false, reason: `PUBLIC_BASE_URL berisi alamat lokal (${media.PUBLIC_BASE_URL}) — mustahil dijangkau Buffer dari luar.` });
  }

  try {
    // Minta 1KB pertama saja: cukup untuk membuktikan URL-nya bisa diakses
    // publik tanpa mengunduh seluruh video.
    const probe = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    result.status = probe.status;
    result.contentType = probe.headers.get('content-type');
    result.acceptRanges = probe.headers.get('accept-ranges');

    if (probe.status !== 200 && probe.status !== 206) {
      return res.json({ ...result, ok: false, reason: `URL membalas HTTP ${probe.status}. Buffer tidak akan bisa mengunduhnya.` });
    }
    if (!/^video\//i.test(result.contentType || '')) {
      return res.json({ ...result, ok: false, reason: `Content-Type "${result.contentType}" bukan video. Kemungkinan yang terbuka halaman login atau halaman error, bukan filenya.` });
    }
    return res.json({ ...result, ok: true, reason: 'Video bisa diunduh dari luar.' });
  } catch (err) {
    return res.json({ ...result, ok: false, reason: `Tidak bisa menghubungi ${url} — ${err.message}` });
  }
}));

/** Uji koneksi ke Hermes. Dipakai tombol diagnosa di halaman Stok. */
router.get('/api/ai/test', asyncHandler(async (req, res) => {
  res.json(await ai.selfTest());
}));

// ---------- caption (kontrak lama dipertahankan) ----------
router.post('/api/caption', asyncHandler(async (req, res) => {
  const { brief, platforms, title } = req.body || {};
  if (!Array.isArray(platforms) || !platforms.length) throw new HttpError('platforms kosong', 400);
  const captions = await ai.generateCaptions({ brief, platforms, title });
  res.json({ captions });
}));

module.exports = router;
