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
const groups = require('../lib/groups');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

// Zona waktu Indonesia; kalau setelan sekarang di luar daftar, ikut disertakan
// supaya tidak diam-diam berubah saat halaman disimpan.
const ZONA = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

router.get('/api/settings', asyncHandler(async (req, res) => {
  const umum = settings.globalSettings();

  let channels = [];
  let channelProblem = null;
  let channelErrors = [];
  try {
    // ?refresh=1 memaksa daftar channel diambil ulang dari Buffer. Ini satu-satunya
    // jalan keluar kalau sebuah channel disambungkan ulang dan ID-nya berubah:
    // cachenya bertahan 1 jam DAN ikut tersimpan di volume permanen, jadi
    // deploy ulang pun tidak membersihkannya.
    //
    // `errors` WAJIB ikut diambil. Kalau satu akun gagal sementara yang lain
    // berhasil, discoverChannels tidak melempar — dia mengembalikan channel
    // yang berhasil saja. Dulu `errors` dibuang di sini, jadi token yang salah
    // atau kedaluwarsa membuat channelnya hilang tanpa satu pun keterangan.
    ({ channels, errors: channelErrors = [] } = await buffer.discoverChannels({
      force: req.query.refresh === '1'
    }));
  } catch (err) {
    channelProblem = err.message;
  }

  // Akun yang tokennya terbaca tapi tidak menghasilkan channel apa pun. Ini
  // membedakan "token bermasalah" dari "channelnya tersambung di akun Buffer
  // yang lain" — dua hal yang tindakan perbaikannya berbeda jauh.
  const punyaChannel = new Set(channels.map((c) => c.account));
  const akunKosong = buffer.daftarAkun().filter((a) => !punyaChannel.has(a));

  const tersimpanChannel = settings.readChannelsRaw();

  res.json({
    umum,
    bawaan: settings.envDefaults(),
    tersimpan: settings.readGlobalRaw(),
    // Halaman Pengaturan sengaja melihat SEMUA channel lintas grup — di sinilah
    // channel ditetapkan grupnya, jadi menyaringnya per grup akan membuat
    // channel yang belum bergrup mustahil diperbaiki.
    channels: channels.map((c) => ({
      id: c.id,
      label: c.label,
      platform: c.platform,
      account: c.account,
      groupId: tersimpanChannel[c.id]?.groupId || '',
      efektif: settings.forChannel(c.id),
      tersimpan: tersimpanChannel[c.id] || {}
    })),
    groups: groups.daftar(),
    bawaanGrup: groups.bawaanId(),
    channelProblem,
    channelErrors,
    akunKosong,
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
      // Daftar akun Buffer yang tokennya terisi, bukan lagi dua nama tetap.
      // Menambah akun cukup dengan variabel BUFFER_TOKEN_<NAMA> baru.
      bufferAkun: buffer.daftarAkun()
    },
    usage: buffer.usageSnapshot()
  });
}));

router.patch('/api/settings', asyncHandler(async (req, res) => {
  const umum = settings.saveGlobal(req.body || {});
  res.json({ umum, tersimpan: settings.readGlobalRaw() });
}));

module.exports = router;
