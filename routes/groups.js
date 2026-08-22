/**
 * Grup brand: buat, ubah, hapus, dan tetapkan channel ke sebuah grup.
 *
 * Grup adalah pemisah paling tegas di aplikasi ini — begitu sebuah channel
 * masuk grup, isi grup lain tidak akan pernah bisa dikirim ke sana. Karena itu
 * penghapusan dijaga ketat: grup yang masih dipakai tidak boleh hilang begitu
 * saja, karena isinya akan jadi yatim dan menghilang dari semua halaman.
 */
const express = require('express');
const groups = require('../lib/groups');
const buffer = require('../lib/buffer');
const appSettings = require('../lib/settings');
const { channelTanpaGrup } = require('../lib/group-scope');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

/** Daftar grup, lengkap dengan berapa banyak isinya. */
router.get('/api/groups', asyncHandler(async (req, res) => {
  const daftar = groups.daftar();

  // Channel dibaca dari cache supaya halaman ini tidak memakan kuota Buffer.
  let channels = [];
  try {
    ({ channels } = await buffer.discoverChannels());
  } catch {
    channels = [];
  }
  const setelan = groups.setelanChannel();

  res.json({
    groups: daftar.map((g) => ({ ...g, isi: groups.pemakai(g.id) })),
    bawaanId: groups.bawaanId(),
    // Channel yang belum ditetapkan grupnya sengaja dilaporkan terpisah:
    // dia tidak masuk grup mana pun, jadi tanpa ini dia tidak muncul di layar
    // sama sekali dan orangnya tidak pernah tahu harus menetapkannya.
    tanpaGrup: channelTanpaGrup(channels, setelan).map((c) => ({
      id: c.id, label: c.label, platform: c.platform, account: c.account
    })),
    channels: channels.map((c) => ({
      id: c.id,
      label: c.label,
      platform: c.platform,
      account: c.account,
      groupId: setelan[c.id]?.groupId || ''
    }))
  });
}));

router.post('/api/groups', asyncHandler(async (req, res) => {
  res.json({ group: groups.buat(req.body || {}) });
}));

router.patch('/api/groups/:id', asyncHandler(async (req, res) => {
  res.json({ group: groups.ubah(req.params.id, req.body || {}) });
}));

router.delete('/api/groups/:id', asyncHandler(async (req, res) => {
  res.json(groups.hapus(req.params.id));
}));

/**
 * Tetapkan grup sebuah channel.
 *
 * Disimpan di channel-settings.json bersama board dan jam tayang, bukan di file
 * sendiri: pemindahan setelan saat channel disambungkan ulang di Buffer
 * (POST /api/channels/pindah) menyalin seluruh objek setelan, jadi grupnya ikut
 * berpindah tanpa kode tambahan.
 */
router.post('/api/groups/:id/channels', asyncHandler(async (req, res) => {
  const { channelIds } = req.body || {};
  if (!Array.isArray(channelIds) || !channelIds.length) {
    throw new HttpError('channelIds harus berisi minimal satu channel', 400);
  }
  if (!groups.cari(req.params.id)) throw new HttpError('Grup tidak ditemukan', 404);

  for (const id of channelIds) appSettings.saveChannel(id, { groupId: req.params.id });
  res.json({ ok: true, ditetapkan: channelIds.length, groupId: req.params.id });
}));

module.exports = router;
