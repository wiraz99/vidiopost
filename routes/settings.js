/**
 * Setelan aplikasi.
 *
 * Yang dulu cuma bisa diubah lewat environment variable + deploy ulang sekarang
 * bisa diatur dari halaman Pengaturan. Yang tetap di environment cuma hal yang
 * memang milik server (port, folder, URL publik, token) — itu ditampilkan
 * sebagai keterangan baca-saja supaya jelas letaknya di mana.
 */
const express = require('express');
const settings = require('../lib/settings');
const buffer = require('../lib/buffer');
const media = require('../lib/media');
const store = require('../lib/store');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

// Zona waktu Indonesia; kalau setelan sekarang di luar daftar, ikut disertakan
// supaya tidak diam-diam berubah saat halaman disimpan.
const ZONA = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

router.get('/api/settings', asyncHandler(async (req, res) => {
  const umum = settings.globalSettings();

  let channels = [];
  let channelProblem = null;
  try {
    // ?refresh=1 memaksa daftar channel diambil ulang dari Buffer. Ini satu-satunya
    // jalan keluar kalau sebuah channel disambungkan ulang dan ID-nya berubah:
    // cachenya bertahan 1 jam DAN ikut tersimpan di volume permanen, jadi
    // deploy ulang pun tidak membersihkannya.
    ({ channels } = await buffer.discoverChannels({ force: req.query.refresh === '1' }));
  } catch (err) {
    channelProblem = err.message;
  }

  const tersimpanChannel = settings.readChannelsRaw();

  res.json({
    umum,
    bawaan: settings.envDefaults(),
    tersimpan: settings.readGlobalRaw(),
    channels: channels.map((c) => ({
      id: c.id,
      label: c.label,
      platform: c.platform,
      account: c.account,
      efektif: settings.forChannel(c.id),
      tersimpan: tersimpanChannel[c.id] || {}
    })),
    channelProblem,
    pilihan: {
      postTypes: settings.PLATFORM_POST_TYPES,
      youtubePrivacy: settings.YOUTUBE_PRIVACY,
      timezones: [...new Set([...ZONA, umum.timezone])]
    },
    server: {
      publicBaseUrl: media.PUBLIC_BASE_URL,
      publicBaseUrlLooksLocal: media.baseUrlLooksLocal(),
      mediaDir: store.MEDIA_DIR,
      dataDir: store.DATA_DIR,
      hermes: !!process.env.HERMES_API_URL,
      hermesModel: process.env.HERMES_MODEL || 'hermes',
      bufferA: !!process.env.BUFFER_TOKEN_A,
      bufferB: !!process.env.BUFFER_TOKEN_B
    },
    usage: buffer.usageSnapshot()
  });
}));

router.patch('/api/settings', asyncHandler(async (req, res) => {
  const umum = settings.saveGlobal(req.body || {});
  res.json({ umum, tersimpan: settings.readGlobalRaw() });
}));

module.exports = router;
