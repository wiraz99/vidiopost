/**
 * Jadwal rotasi: pratinjau, simpan, siapkan caption, kirim per item.
 *
 * Pengiriman sengaja dilakukan SATU ITEM PER REQUEST. Alasannya:
 *  - 10 video x 6 channel = 60 post; kalau dikirim sekaligus, request HTTP-nya
 *    kelamaan dan gampang timeout
 *  - progres bisa ditampilkan per item
 *  - retry per item jadi gratis, tinggal panggil ulang endpoint yang sama
 */
const express = require('express');
const store = require('../lib/store');
const buffer = require('../lib/buffer');
const ai = require('../lib/ai');
const { buildRotation, QUEUE_LIMIT } = require('../lib/rotation');
const { buildPost } = require('../lib/compose');
const { tagsFor } = require('./hashtags');
const { resolveLink } = require('./links');
const { boardFor } = require('./channels');
const media = require('../lib/media');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

const readPlans = () => store.read('plans', []);
const writePlans = (p) => store.write('plans', p);
const readVideos = () => store.read('videos', []);

function findPlan(id) {
  const plans = readPlans();
  const plan = plans.find((p) => p.id === id);
  if (!plan) throw new HttpError('Jadwal tidak ditemukan', 404);
  return { plans, plan };
}

/** Kumpulkan bahan rotasi dari body request. */
async function gather(body) {
  const { videoIds, channelIds, startDate, timezone, daysBetween, offsetStep, channelHours, days } = body || {};

  const allVideos = readVideos();
  const videos = Array.isArray(videoIds) && videoIds.length
    ? videoIds.map((id) => allVideos.find((v) => v.id === id)).filter(Boolean)
    : allVideos.filter((v) => v.status === 'stock');

  const { channels: allChannels } = await buffer.discoverChannels();
  const channels = Array.isArray(channelIds) && channelIds.length
    ? channelIds.map((id) => allChannels.find((c) => c.id === id)).filter(Boolean)
    : allChannels;

  // Antrian asli dipakai untuk memperingatkan batas 10/channel.
  let existingScheduled = {};
  let queueError = null;
  try {
    // Pratinjau boleh memakai data agak lama — angkanya cuma untuk peringatan,
    // dan pratinjau dihitung ulang tiap kali user mencentang sesuatu.
    ({ counts: existingScheduled } = await buffer.scheduledCounts({ maxAgeMs: 30 * 60 * 1000 }));
  } catch (err) {
    queueError = err.message;
  }

  return {
    videos,
    channels,
    queueError,
    options: {
      startDate: startDate || new Date().toISOString().slice(0, 10),
      timezone: timezone || process.env.TIMEZONE || 'Asia/Jakarta',
      daysBetween: Number(daysBetween) || 1,
      offsetStep: Number(offsetStep) || 1,
      channelHours: channelHours || {},
      days: days ? Number(days) : null,
      existingScheduled
    }
  };
}

// ---------- pratinjau ----------
router.post('/api/plan/preview', asyncHandler(async (req, res) => {
  const { videos, channels, options, queueError } = await gather(req.body);
  const result = buildRotation({ videos, channels, ...options });
  if (queueError) result.warnings.push(`Tidak bisa membaca antrian Buffer: ${queueError}`);
  res.json({ ...result, queueLimit: QUEUE_LIMIT, timezone: options.timezone });
}));

// ---------- simpan jadwal ----------
router.post('/api/plan', asyncHandler(async (req, res) => {
  const { videos, channels, options } = await gather(req.body);
  const { items, matrix, warnings } = buildRotation({ videos, channels, ...options });
  if (!items.length) throw new HttpError(warnings[0] || 'Jadwal kosong', 400);

  const plan = {
    id: store.uid('plan'),
    createdAt: new Date().toISOString(),
    startDate: options.startDate,
    timezone: options.timezone,
    daysBetween: options.daysBetween,
    offsetStep: options.offsetStep,
    videoIds: videos.map((v) => v.id),
    channelIds: channels.map((c) => c.id),
    hashtagSetIds: req.body?.hashtagSetIds || [],
    items: items.map((item, index) => ({ ...item, index, bufferPostId: null, error: null }))
  };

  const plans = readPlans();
  plans.unshift(plan);
  writePlans(plans);

  // Video yang masuk jadwal ditandai supaya tidak ikut lagi di jadwal berikutnya.
  const allVideos = readVideos();
  for (const v of allVideos) if (plan.videoIds.includes(v.id)) v.status = 'scheduled';
  store.write('videos', allVideos);

  res.json({ plan, matrix, warnings });
}));

router.get('/api/plan', (req, res) => {
  // Ringkasan saja — items bisa panjang sekali.
  const plans = readPlans().map((p) => ({
    id: p.id,
    createdAt: p.createdAt,
    startDate: p.startDate,
    timezone: p.timezone,
    total: p.items.length,
    sent: p.items.filter((i) => i.status === 'sent').length,
    failed: p.items.filter((i) => i.status === 'error').length
  }));
  res.json({ plans });
});

router.get('/api/plan/:id', asyncHandler(async (req, res) => {
  const { plan } = findPlan(req.params.id);
  res.json({ plan });
}));

router.delete('/api/plan/:id', asyncHandler(async (req, res) => {
  const plans = readPlans();
  const index = plans.findIndex((p) => p.id === req.params.id);
  if (index === -1) throw new HttpError('Jadwal tidak ditemukan', 404);
  const [removed] = plans.splice(index, 1);
  writePlans(plans);

  // Video dikembalikan ke stok kalau belum ada yang terkirim.
  if (!removed.items.some((i) => i.status === 'sent')) {
    const videos = readVideos();
    for (const v of videos) if (removed.videoIds.includes(v.id)) v.status = 'stock';
    store.write('videos', videos);
  }
  res.json({ ok: true });
}));

// ---------- siapkan caption ----------
/**
 * Generate caption satu video untuk semua platform yang dipakai di jadwal ini.
 * Frontend memanggilnya per video supaya progresnya kelihatan.
 */
router.post('/api/plan/:id/caption/:videoId', asyncHandler(async (req, res) => {
  const { plan } = findPlan(req.params.id);

  const videos = readVideos();
  const video = videos.find((v) => v.id === req.params.videoId);
  if (!video) throw new HttpError('Video tidak ditemukan', 404);

  const platforms = [...new Set(plan.items.filter((i) => i.videoId === video.id).map((i) => i.platform))];
  if (!platforms.length) throw new HttpError('Video ini tidak ada di jadwal tersebut', 400);

  const brief = (req.body?.brief || video.brief || video.title || '').trim();
  if (!brief) throw new HttpError('Video ini belum punya judul atau brief', 400);

  const captions = await ai.generateCaptions({ brief, platforms, title: video.title });
  video.captions = { ...video.captions, ...captions };
  video.brief = brief;
  store.write('videos', videos);

  res.json({ videoId: video.id, captions: video.captions });
}));

// ---------- kirim satu item ----------
router.post('/api/plan/:id/send/:index', asyncHandler(async (req, res) => {
  const { plans, plan } = findPlan(req.params.id);
  const item = plan.items[Number(req.params.index)];
  if (!item) throw new HttpError('Item jadwal tidak ditemukan', 404);

  if (item.status === 'sent') {
    return res.json({ item, skipped: true, reason: 'Sudah terkirim sebelumnya' });
  }

  const video = readVideos().find((v) => v.id === item.videoId);
  if (!video) throw new HttpError('Video untuk item ini sudah dihapus', 400);

  const hashtags = tagsFor(plan.hashtagSetIds, item.platform);
  const { text, metadata, missing, warning } = buildPost({
    platform: item.platform,
    title: video.title,
    caption: video.captions?.[item.platform] || '',
    hashtags,
    link: resolveLink(video, item.platform),
    boardId: item.boardId || boardFor(item.channelId)
  });

  // Field wajib yang belum terisi dicegat di sini, sebelum request dikirim —
  // percuma membakar kuota untuk post yang pasti ditolak Buffer.
  if (missing.length || !text.trim()) {
    item.status = 'error';
    item.error = missing.length
      ? `Belum lengkap: ${missing.join(', ')}`
      : `Belum ada teks untuk ${item.channelLabel}. Generate caption dulu.`;
    writePlans(plans);
    return res.json({ item, usage: buffer.usageSnapshot() });
  }

  try {
    const post = await buffer.createPost({
      account: item.account,
      channelId: item.channelId,
      text,
      metadata,
      videoUrl: media.publicUrl(video.filename),
      dueAt: item.dueAt,
      mode: 'customScheduled'
    });
    item.status = 'sent';
    item.bufferPostId = post.id;
    item.error = null;
    item.sentAt = new Date().toISOString();
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
  }

  item.textLength = text.length;
  item.lengthWarning = warning;
  writePlans(plans);

  res.json({ item, usage: buffer.usageSnapshot() });
}));

/** Teks final yang AKAN dikirim, untuk pratinjau sebelum benar-benar dikirim. */
router.get('/api/plan/:id/text/:index', asyncHandler(async (req, res) => {
  const { plan } = findPlan(req.params.id);
  const item = plan.items[Number(req.params.index)];
  if (!item) throw new HttpError('Item jadwal tidak ditemukan', 404);

  const video = readVideos().find((v) => v.id === item.videoId);
  const hashtags = tagsFor(plan.hashtagSetIds, item.platform);
  const { text, metadata, missing, warning } = buildPost({
    platform: item.platform,
    title: video?.title || '',
    caption: video?.captions?.[item.platform] || '',
    hashtags,
    link: resolveLink(video, item.platform),
    boardId: item.boardId || boardFor(item.channelId)
  });
  res.json({ text, length: text.length, warning, metadata, missing });
}));

module.exports = router;
