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

  try {
    const boards = await buffer.channelBoards(channel.account, channel.id, { force: req.query.refresh === '1' });
    res.json({ boards, selected: readSettings()[channel.id]?.boardId || '' });
  } catch (err) {
    res.json({ boards: [], problem: err.message, selected: readSettings()[channel.id]?.boardId || '' });
  }
}));

// Sekarang menerima semua setelan per channel (board, jam tayang, tipe post,
// kategori & privasi YouTube), bukan cuma boardId. Validasinya di lib/settings.
router.patch('/api/channels/:id/settings', asyncHandler(async (req, res) => {
  const efektif = appSettings.saveChannel(req.params.id, req.body || {});
  res.json({ settings: appSettings.readChannelsRaw()[req.params.id] || {}, efektif });
}));

/** Board yang dipilih untuk sebuah channel; dipakai saat menyusun post. */
const boardFor = (channelId) => appSettings.forChannel(channelId).boardId || '';

module.exports = router;
module.exports.boardFor = boardFor;
