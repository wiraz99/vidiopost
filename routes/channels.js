/**
 * Channel & antrian.
 * Daftar channel sekarang dibaca langsung dari Buffer (channels.json cuma jadi
 * penimpa label/platform dan jalan mundur kalau API gagal), dan hitungan antrian
 * dibaca dari antrian asli — bukan lagi hitungan lokal yang harus disinkron manual.
 */
const express = require('express');
const store = require('../lib/store');
const buffer = require('../lib/buffer');
const appSettings = require('../lib/settings');
const { QUEUE_LIMIT } = require('../lib/rotation');
const { cariPengganti, alihkanItem } = require('../lib/channel-map');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

// Kontrak lama: mengembalikan ARRAY channel apa adanya.
// Kalau channel belum bisa dibaca, balas array kosong (bukan 500) supaya
// pemanggil lama tidak pecah; alasannya bisa dilihat di /api/channels/detail.
router.get('/api/channels', asyncHandler(async (req, res) => {
  try {
    const { channels } = await buffer.discoverChannels({ force: req.query.refresh === '1' });
    res.json(channels);
  } catch {
    res.json([]);
  }
}));

// Versi baru dengan keterangan tambahan: dari mana datanya, kapan diambil,
// dan kenapa kosong kalau memang kosong.
router.get('/api/channels/detail', asyncHandler(async (req, res) => {
  try {
    const result = await buffer.discoverChannels({ force: req.query.refresh === '1' });
    res.json({ ...result, usage: buffer.usageSnapshot() });
  } catch (err) {
    res.json({
      channels: [],
      source: 'none',
      problem: err.message,
      needsToken: !buffer.anyToken(),
      usage: buffer.usageSnapshot()
    });
  }
}));

// Kontrak lama dipertahankan: { limit, counts }. Isinya sekarang dari Buffer.
router.get('/api/queue', asyncHandler(async (req, res) => {
  const { channels } = await buffer.discoverChannels();
  const { counts, errors, fetchedAt, cached } = await buffer.scheduledCounts({ force: req.query.refresh === '1' });

  const full = {};
  for (const c of channels) full[c.id] = counts[c.id] || 0;

  res.json({ limit: QUEUE_LIMIT, counts: full, errors, fetchedAt, cached, usage: buffer.usageSnapshot() });
}));

router.get('/api/usage', (req, res) => res.json(buffer.usageSnapshot()));

// ---------------- setelan per channel ----------------
// Sekarang isinya baru board Pinterest, tapi sengaja dibuat umum supaya
// setelan lain per channel bisa menyusul tanpa mengubah bentuk datanya.

const readSettings = () => store.read('channel-settings', {});

router.get('/api/channels/settings', (req, res) => res.json({ settings: readSettings() }));

/** Board Pinterest milik sebuah channel, untuk ditampilkan sebagai pilihan. */
router.get('/api/channels/:id/boards', asyncHandler(async (req, res) => {
  const { channels } = await buffer.discoverChannels();
  const channel = channels.find((c) => c.id === req.params.id);
  if (!channel) throw new HttpError('Channel tidak ditemukan', 404);
  if (channel.platform !== 'pinterest') return res.json({ boards: [], reason: 'Bukan channel Pinterest' });

  const terpilih = () => readSettings()[channel.id]?.boardId || '';

  try {
    const { boards, channelAda } = await buffer.channelBoards(channel.account, channel.id, {
      force: req.query.refresh === '1'
    });
    // channelAda=false berarti channel-nya sendiri sudah tidak ada di Buffer
    // (biasanya karena disambungkan ulang), bukan sekadar belum punya board.
    res.json({ boards, channelAda, selected: terpilih() });
  } catch (err) {
    res.json({ boards: [], channelAda: null, problem: err.message, selected: terpilih() });
  }
}));

// Sekarang menerima semua setelan per channel (board, jam tayang, tipe post,
// kategori & privasi YouTube), bukan cuma boardId. Validasinya di lib/settings.
router.patch('/api/channels/:id/settings', asyncHandler(async (req, res) => {
  const efektif = appSettings.saveChannel(req.params.id, req.body || {});
  res.json({ settings: appSettings.readChannelsRaw()[req.params.id] || {}, efektif });
}));

// ---------------- channel yang disambungkan ulang ----------------

/**
 * Menyambung ulang channel di Buffer memberi ID baru, sehingga setelan lama
 * (board, jam tayang) dan item jadwal yang belum terkirim jadi menggantung.
 * Endpoint ini melaporkan temuannya beserta calon penggantinya.
 */
router.get('/api/channels/yatim', asyncHandler(async (req, res) => {
  let channels = [];
  let problem = null;
  try {
    ({ channels } = await buffer.discoverChannels({ force: req.query.refresh === '1' }));
  } catch (err) {
    problem = err.message;
  }

  const itemJadwal = store.read('plans', []).flatMap((p) => p.items || []);
  const temuan = cariPengganti({
    channelsSekarang: channels,
    setelanTersimpan: readSettings(),
    itemJadwal
  });

  res.json({ temuan, problem, usage: buffer.usageSnapshot() });
}));

/** Pindahkan setelan + item jadwal yang belum terkirim ke channel pengganti. */
router.post('/api/channels/pindah', asyncHandler(async (req, res) => {
  const { dari, ke } = req.body || {};
  if (!dari || !ke) throw new HttpError('Butuh id channel lama (dari) dan baru (ke)', 400);
  if (dari === ke) throw new HttpError('Channel lama dan barunya sama', 400);

  const { channels } = await buffer.discoverChannels();
  const tujuan = channels.find((c) => c.id === ke);
  if (!tujuan) throw new HttpError('Channel tujuan tidak ada di daftar Buffer', 400);

  // 1. setelan channel
  const settings = readSettings();
  const setelanLama = settings[dari];
  let setelanPindah = false;
  if (setelanLama && Object.keys(setelanLama).length) {
    // Jangan menimpa setelan yang sudah ada di channel tujuan.
    settings[tujuan.id] = { ...setelanLama, ...(settings[tujuan.id] || {}) };
    delete settings[dari];
    store.write('channel-settings', settings);
    setelanPindah = true;
  }

  // 2. item jadwal yang belum terkirim
  const plans = store.read('plans', []);
  const { diubah, dilewati } = alihkanItem(plans, dari, tujuan);
  if (diubah) store.write('plans', plans);

  res.json({ ok: true, setelanPindah, diubah, dilewati, tujuan });
}));

/** Board yang dipilih untuk sebuah channel; dipakai saat menyusun post. */
const boardFor = (channelId) => appSettings.forChannel(channelId).boardId || '';

module.exports = router;
module.exports.boardFor = boardFor;
