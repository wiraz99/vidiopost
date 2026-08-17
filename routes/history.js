/**
 * Riwayat publish + endpoint /api/publish lama.
 *
 * Kontrak lama dipertahankan persis; yang berubah cuma bagian dalamnya
 * (sekarang lewat lib/buffer supaya ikut terhitung ke penjaga rate limit).
 * Hitungan antrian TIDAK lagi dicatat di sini — dibaca langsung dari Buffer.
 */
const express = require('express');
const store = require('../lib/store');
const buffer = require('../lib/buffer');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

const readHistory = () => store.read('history', []);
const MAX_ENTRIES = 500;

// ---------- publish langsung (kontrak lama) ----------
router.post('/api/publish', asyncHandler(async (req, res) => {
  const { videoUrl, captionsByChannelId, channelIds } = req.body || {};
  if (!Array.isArray(channelIds)) throw new HttpError('channelIds harus array', 400);

  const { channels } = await buffer.discoverChannels();
  const results = [];

  for (const channelId of channelIds) {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      results.push({ channelId, ok: false, error: 'Channel tidak ditemukan' });
      continue;
    }
    try {
      const post = await buffer.createPost({
        account: channel.account,
        channelId,
        text: captionsByChannelId?.[channelId] || '',
        videoUrl,
        mode: 'addToQueue'
      });
      results.push({ channelId, label: channel.label, ok: true, postId: post.id });
    } catch (err) {
      results.push({ channelId, label: channel.label, ok: false, error: err.message });
    }
  }

  res.json({ results });
}));

// ---------- riwayat ----------
router.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, MAX_ENTRIES);
  res.json({ entries: readHistory().slice(0, limit) });
});

router.post('/api/history', asyncHandler(async (req, res) => {
  const { filename, videoUrl, brief, results, planId } = req.body || {};
  if (!Array.isArray(results)) throw new HttpError('results harus array', 400);

  const { channels } = await buffer.discoverChannels().catch(() => ({ channels: [] }));
  const now = new Date().toISOString();

  const entry = {
    id: store.uid('h'),
    createdAt: now,
    filename: filename || '',
    videoUrl: videoUrl || '',
    brief: brief || '',
    planId: planId || null,
    results: results.map((r) => {
      const channel = channels.find((c) => c.id === r.channelId);
      return {
        channelId: r.channelId,
        label: channel?.label || r.label || r.channelId,
        platform: channel?.platform || r.platform || '',
        ok: !!r.ok,
        error: r.ok ? null : (r.error || null),
        bufferPostId: r.bufferPostId || null,
        at: now
      };
    })
  };

  const entries = readHistory();
  entries.unshift(entry);
  store.write('history', entries.slice(0, MAX_ENTRIES));
  res.json({ entry });
}));

router.post('/api/history/:id/result', asyncHandler(async (req, res) => {
  const { channelId, ok, error, bufferPostId } = req.body || {};
  const entries = readHistory();
  const entry = entries.find((e) => e.id === req.params.id);
  if (!entry) throw new HttpError('Riwayat tidak ditemukan', 404);

  const { channels } = await buffer.discoverChannels().catch(() => ({ channels: [] }));
  const channel = channels.find((c) => c.id === channelId);
  const patch = {
    channelId,
    label: channel?.label || channelId,
    platform: channel?.platform || '',
    ok: !!ok,
    error: ok ? null : (error || null),
    bufferPostId: bufferPostId || null,
    at: new Date().toISOString()
  };

  const existing = entry.results.find((r) => r.channelId === channelId);
  if (existing) Object.assign(existing, patch);
  else entry.results.push(patch);

  store.write('history', entries);
  res.json({ entry });
}));

module.exports = router;
