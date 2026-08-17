/**
 * Channel & antrian.
 * Daftar channel sekarang dibaca langsung dari Buffer (channels.json cuma jadi
 * penimpa label/platform dan jalan mundur kalau API gagal), dan hitungan antrian
 * dibaca dari antrian asli — bukan lagi hitungan lokal yang harus disinkron manual.
 */
const express = require('express');
const buffer = require('../lib/buffer');
const { QUEUE_LIMIT } = require('../lib/rotation');
const { asyncHandler } = require('../lib/http');

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

module.exports = router;
