/** Stok video: upload, daftar, edit judul, saran judul SEO, hapus. */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const store = require('../lib/store');
const ai = require('../lib/ai');
const media = require('../lib/media');
const groups = require('../lib/groups');
const { saring } = require('../lib/group-scope');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

/**
 * Nama file diberi bagian acak.
 *
 * Folder /media tidak bisa dikunci di balik login: Buffer mengunduh videonya
 * dari luar tanpa membawa kredensial apa pun. Jadi satu-satunya perlindungan
 * yang tersisa adalah alamat yang tidak bisa ditebak.
 *
 * Sebelumnya namanya cuma `<waktu>-<nama asli>`, yang berarti siapa pun yang
 * tahu domainnya bisa menerka alamat video orang lain dengan mencoba beberapa
 * stempel waktu.
 *
 * File LAMA sengaja tidak ikut diganti namanya: post yang sudah dijadwalkan di
 * Buffer menyimpan URL lamanya, dan mengganti nama file akan membuat Buffer
 * gagal mengunduhnya saat waktu tayang tiba.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, store.MEDIA_DIR),
  filename: (req, file, cb) => {
    const acak = crypto.randomBytes(9).toString('base64url'); // 72 bit
    const asli = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-60);
    cb(null, `${Date.now()}-${acak}-${asli}`);
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

  // Video langsung menjadi milik grup yang sedang aktif. Tanpa ini video brand
  // baru mendarat di grup bawaan dan baru ketahuan salah saat menyusun jadwal.
  const grup = groups.resolusi(req.query.grup === 'semua' ? '' : req.query.grup);

  const video = {
    id: store.uid('vid'),
    groupId: grup.id,
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
/**
 * Rekam jejak tiap video di seluruh jadwal: sudah benar-benar terkirim ke
 * platform apa saja, masih mengantre di mana, dan di mana pernah gagal.
 *
 * Dihitung dari plans.json, bukan disimpan di videos.json — status item bisa
 * berubah kapan saja (dikirim ulang, dijadwalkan ulang, jadwalnya dihapus),
 * jadi salinan yang disimpan akan cepat berbohong.
 */
function jejakPerVideo() {
  const peta = new Map();
  for (const plan of store.read('plans', [])) {
    for (const item of plan.items || []) {
      if (!item.videoId) continue;
      if (!peta.has(item.videoId)) {
        peta.set(item.videoId, { terkirim: new Set(), terjadwal: new Set(), gagal: new Set() });
      }
      const e = peta.get(item.videoId);
      if (item.status === 'sent') e.terkirim.add(item.platform);
      else if (item.status === 'error') e.gagal.add(item.platform);
      else e.terjadwal.add(item.platform);
    }
  }
  return peta;
}

router.get('/api/videos', (req, res) => {
  const { status } = req.query;
  const grup = groups.resolusi(req.query.grup);
  const bawaanId = groups.bawaanId();

  const videos = readVideos();
  const segrup = grup.semua ? videos : saring(videos, grup.id, bawaanId);
  const list = status ? segrup.filter((v) => v.status === status) : segrup;
  const jejak = jejakPerVideo();

  res.json({
    groupId: grup.id,
    grupTidakDikenal: grup.tidakDikenal,
    videos: list.map((v) => {
      const e = jejak.get(v.id) || { terkirim: new Set(), terjadwal: new Set(), gagal: new Set() };
      // Tiap platform hanya boleh muncul sekali, dengan keadaan TERKINI-nya.
      // Sebuah platform bisa gagal di jadwal lama lalu diulang di jadwal baru;
      // yang perlu dilihat user adalah posisinya sekarang, bukan riwayatnya.
      // Urutan menang: sudah terkirim > sedang mengantre > pernah gagal.
      const terjadwal = [...e.terjadwal].filter((p) => !e.terkirim.has(p));
      const gagal = [...e.gagal].filter((p) => !e.terkirim.has(p) && !terjadwal.includes(p));
      return { ...media.decorate(v), terkirim: [...e.terkirim], terjadwal, gagal };
    })
  });
});

// `link` = URL tujuan, dipakai Pinterest (lihat lib/compose.js).
const EDITABLE = ['title', 'brief', 'link', 'linkId', 'captions', 'hashtagSetIds', 'status', 'order', 'groupId'];

router.patch('/api/videos/:id', asyncHandler(async (req, res) => {
  const videos = readVideos();
  const video = videos.find((v) => v.id === req.params.id);
  if (!video) throw new HttpError('Video tidak ditemukan', 404);

  // Grup yang tidak ada membuat video hilang dari semua halaman tanpa jejak.
  if (req.body.groupId !== undefined && !groups.cari(req.body.groupId)) {
    throw new HttpError(`Grup "${req.body.groupId}" tidak ada.`, 400);
  }

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

  // Brand diambil dari grup video ini — bukan dari environment. Tanpa ini judul
  // untuk brand kedua tetap menyebut brand pertama.
  const titles = await ai.suggestTitles({
    brief,
    count: req.body?.count || 5,
    ...groups.brandUntuk(video.groupId)
  });

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

  res.json(await media.checkPublicUrl(video.filename, { force: req.query.refresh === '1' }));
}));

/** Uji koneksi ke Hermes. Dipakai tombol diagnosa di halaman Stok. */
router.get('/api/ai/test', asyncHandler(async (req, res) => {
  res.json(await ai.selfTest());
}));

// ---------- caption (kontrak lama dipertahankan) ----------
router.post('/api/caption', asyncHandler(async (req, res) => {
  const { brief, platforms, title, groupId } = req.body || {};
  if (!Array.isArray(platforms) || !platforms.length) throw new HttpError('platforms kosong', 400);
  const captions = await ai.generateCaptions({
    brief, platforms, title, ...groups.brandUntuk(groupId)
  });
  res.json({ captions });
}));

module.exports = router;
