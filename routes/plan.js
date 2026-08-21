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
const { buildRotation, zonedToUtc, addDays, QUEUE_LIMIT } = require('../lib/rotation');
const { buildPost } = require('../lib/compose');
const { alihkanItem } = require('../lib/channel-map');
const appSettings = require('../lib/settings');
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

// ---------- kelengkapan item ----------

const videoMap = () => new Map(readVideos().map((v) => [v.id, v]));

/**
 * Id channel yang masih ada di Buffer, untuk menandai item yang menunjuk
 * channel mati (biasanya karena channel-nya disambungkan ulang di Buffer).
 *
 * Mengembalikan null kalau daftarnya GAGAL dibaca atau kosong — dan itu penting:
 * kalau tokennya bermasalah, menganggap "tidak ada channel yang hidup" akan
 * menandai seluruh jadwal sebagai rusak. Lebih baik tidak melaporkan apa-apa.
 */
async function channelHidup() {
  try {
    const { channels } = await buffer.discoverChannels();
    return channels?.length ? new Set(channels.map((c) => c.id)) : null;
  } catch {
    return null;
  }
}

/**
 * Lengkapi satu item dengan teks final + apa saja yang masih kurang.
 *
 * Sengaja DIHITUNG ULANG tiap kali jadwal dibaca, bukan disimpan di plans.json:
 * caption, hashtag, tautan dan board Pinterest bisa berubah dari halaman lain
 * kapan saja. Nilai yang tersimpan akan cepat basi dan justru menyesatkan.
 *
 * Ini yang membuat "belum lengkap" ketahuan SEBELUM tombol Kirim ditekan,
 * bukan setelah Buffer menolak satu per satu.
 */
function decorateItem(item, plan, videos, hidup = null, now = Date.now()) {
  const video = videos.get(item.videoId);
  const { text, missing, warning } = buildPost({
    platform: item.platform,
    title: video?.title || '',
    caption: video?.captions?.[item.platform] || '',
    hashtags: tagsFor(plan.hashtagSetIds, item.platform),
    link: resolveLink(video, item.platform),
    boardId: item.boardId || boardFor(item.channelId),
    settings: appSettings.forChannel(item.channelId)
  });

  const kurang = [];
  if (!video) kurang.push('videonya sudah dihapus dari stok');
  else if (!text.trim()) kurang.push(`caption ${item.platform} belum diisi`);

  // Hanya diperiksa kalau daftar channel benar-benar terbaca (lihat channelHidup).
  // Item yang SUDAH terkirim tidak ikut ditandai: id lamanya adalah catatan
  // sejarah yang benar, dan tidak ada tindakan yang perlu diambil untuknya.
  const channelMati = !!hidup && item.status !== 'sent' && !hidup.has(item.channelId);
  if (channelMati) {
    kurang.push(
      `channel "${item.channelLabel}" sudah tidak ada di Buffer — kemungkinan disambungkan ` +
      'ulang sehingga ID-nya berubah. Alihkan ke channel penggantinya dulu.'
    );
  }

  kurang.push(...missing);

  const isPast = new Date(item.dueAt).getTime() <= now;

  // `status` = apa yang tersimpan; `state` = apa yang perlu dilihat user.
  const state = item.status === 'sent' ? 'sent'
    : item.status === 'error' ? 'error'
      : kurang.length ? 'kurang'
        : isPast ? 'kedaluwarsa'
          : 'siap';

  return {
    ...item,
    isPast,
    channelMati,
    missing: kurang,
    ready: !kurang.length && !isPast,
    state,
    caption: video?.captions?.[item.platform] || '',
    preview: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    textLength: text.length,
    lengthWarning: warning
  };
}

/** Ringkasan sebuah jadwal — dipakai daftar maupun halaman detail. */
function summarize(items, plan) {
  const hitung = (fn) => items.filter(fn).length;
  const belum = (i) => i.status !== 'sent';
  const berikut = items
    .filter((i) => belum(i) && !i.isPast)
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))[0] || null;

  return {
    total: items.length,
    sent: hitung((i) => i.status === 'sent'),
    error: hitung((i) => i.status === 'error'),
    kurang: hitung((i) => belum(i) && i.missing.length),
    siap: hitung((i) => belum(i) && i.ready),
    kedaluwarsa: hitung((i) => belum(i) && i.isPast),
    startDate: plan.startDate,
    endDate: items.reduce((max, i) => (i.date > max ? i.date : max), plan.startDate),
    videoCount: plan.videoIds?.length || 0,
    channelCount: plan.channelIds?.length || 0,
    berikutnya: berikut && {
      date: berikut.date, time: berikut.time,
      channelLabel: berikut.channelLabel, videoTitle: berikut.videoTitle
    }
  };
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
      timezone: timezone || appSettings.globalSettings().timezone,
      daysBetween: Number(daysBetween) || 1,
      offsetStep: Number(offsetStep) || 1,
      // Jam tayang bawaan tiap channel diambil dari Pengaturan; yang dikirim
      // dari form menimpanya hanya untuk jadwal yang sedang disusun.
      channelHours: { ...appSettings.channelHours(), ...(channelHours || {}) },
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

  // Tandai tiap sel yang bahannya belum lengkap, supaya kekurangannya
  // kelihatan di tabel pratinjau — bukan baru ketahuan saat dikirim.
  const hashtagSetIds = req.body?.hashtagSetIds || [];
  const byId = new Map(videos.map((v) => [v.id, v]));
  const now = Date.now();

  for (const row of result.matrix) {
    for (const cell of row.cells) {
      const video = byId.get(cell.videoId);
      const { text, missing } = buildPost({
        platform: row.platform,
        title: video?.title || '',
        caption: video?.captions?.[row.platform] || '',
        hashtags: tagsFor(hashtagSetIds, row.platform),
        link: resolveLink(video, row.platform),
        boardId: boardFor(row.channelId),
        settings: appSettings.forChannel(row.channelId)
      });
      const kurang = text.trim() ? [...missing] : [`caption ${row.platform} belum diisi`, ...missing];
      cell.missing = kurang;
      cell.isPast = zonedToUtc(cell.date, cell.time, options.timezone).getTime() <= now;
      cell.ready = !kurang.length && !cell.isPast;
    }
  }

  const belumLengkap = result.matrix.reduce((n, r) => n + r.cells.filter((c) => c.missing.length).length, 0);

  res.json({ ...result, belumLengkap, queueLimit: QUEUE_LIMIT, timezone: options.timezone });
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

router.get('/api/plan', asyncHandler(async (req, res) => {
  // Ringkasan saja — items bisa panjang sekali. Tapi ringkasannya dibuat
  // cukup lengkap supaya kartu di daftar bisa langsung menjawab
  // "sudah sejauh mana" dan "apa yang berikutnya tayang".
  const hidup = await channelHidup();
  const videos = videoMap();
  const plans = readPlans().map((p) => {
    const items = p.items.map((item) => decorateItem(item, p, videos, hidup));
    return {
      id: p.id,
      createdAt: p.createdAt,
      timezone: p.timezone,
      ...summarize(items, p),
      // nama lama tetap ada supaya pemanggil lama tidak pecah
      failed: items.filter((i) => i.status === 'error').length
    };
  });
  res.json({ plans });
}));

router.get('/api/plan/:id', asyncHandler(async (req, res) => {
  const { plan } = findPlan(req.params.id);
  const hidup = await channelHidup();
  const items = plan.items.map((item) => decorateItem(item, plan, videoMap(), hidup));
  res.json({ plan: { ...plan, items }, ringkas: summarize(items, plan) });
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

// ---------- ubah waktu ----------

/** Ubah tanggal/jam satu item. Item yang sudah terkirim tidak bisa diubah. */
router.patch('/api/plan/:id/item/:index', asyncHandler(async (req, res) => {
  const { plans, plan } = findPlan(req.params.id);
  const item = plan.items[Number(req.params.index)];
  if (!item) throw new HttpError('Item jadwal tidak ditemukan', 404);
  if (item.status === 'sent') throw new HttpError('Item ini sudah terkirim ke Buffer, waktunya tidak bisa diubah dari sini.', 400);

  const date = req.body?.date || item.date;
  const time = req.body?.time || item.time;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError('Tanggal tidak valid', 400);
  if (!/^\d{2}:\d{2}$/.test(time)) throw new HttpError('Jam tidak valid', 400);

  const dueAt = zonedToUtc(date, time, plan.timezone);
  if (dueAt.getTime() <= Date.now()) {
    throw new HttpError('Waktu itu sudah lewat. Buffer hanya menerima jadwal di masa depan.', 400);
  }

  Object.assign(item, {
    date,
    time,
    dueAtLocal: `${date}T${time}`,
    dueAt: dueAt.toISOString(),
    isPast: false,
    // Item yang tadinya gagal karena kedaluwarsa jadi siap dicoba lagi.
    status: item.status === 'error' ? 'draft' : item.status,
    error: null
  });
  writePlans(plans);

  const hidup = await channelHidup();
  res.json({ item: decorateItem(item, plan, videoMap(), hidup) });
}));

/**
 * Geser SELURUH item yang belum terkirim ke tanggal mulai baru.
 * Pola rotasinya dipertahankan: tiap item tetap di hari ke-berapa dan
 * jam yang sama, cuma titik awalnya yang berpindah.
 */
router.post('/api/plan/:id/reschedule', asyncHandler(async (req, res) => {
  const { plans, plan } = findPlan(req.params.id);
  const startDate = req.body?.startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) throw new HttpError('Tanggal mulai tidak valid', 400);

  const daysBetween = plan.daysBetween || 1;
  let diubah = 0;
  let dilewati = 0;

  for (const item of plan.items) {
    if (item.status === 'sent') { dilewati++; continue; }

    const date = addDays(startDate, (item.dayIndex || 0) * daysBetween);
    const dueAt = zonedToUtc(date, item.time, plan.timezone);

    Object.assign(item, {
      date,
      dueAtLocal: `${date}T${item.time}`,
      dueAt: dueAt.toISOString(),
      isPast: dueAt.getTime() <= Date.now(),
      status: item.status === 'error' ? 'draft' : item.status,
      error: null
    });
    diubah++;
  }

  plan.startDate = startDate;
  writePlans(plans);

  const hidup = await channelHidup();
  const items = plan.items.map((item) => decorateItem(item, plan, videoMap(), hidup));
  const masihLewat = items.filter((i) => i.isPast && i.status !== 'sent').length;
  res.json({
    plan: { ...plan, items },
    ringkas: summarize(items, plan),
    diubah,
    dilewati,
    warning: masihLewat
      ? `${masihLewat} item masih jatuh di waktu yang sudah lewat. Pilih tanggal mulai yang lebih jauh.`
      : null
  });
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

  const dipakai = [...new Set(plan.items.filter((i) => i.videoId === video.id).map((i) => i.platform))];
  if (!dipakai.length) throw new HttpError('Video ini tidak ada di jadwal tersebut', 400);

  // Boleh dipersempit ke satu platform — dipakai tombol "Tulis ulang" di
  // dalam baris item, supaya tidak menimpa caption platform lain yang
  // barangkali sudah diedit tangan.
  const diminta = Array.isArray(req.body?.platforms) ? req.body.platforms.filter((p) => dipakai.includes(p)) : [];
  const platforms = diminta.length ? diminta : dipakai;

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

  const hidup = await channelHidup();

  if (item.status === 'sent') {
    return res.json({
      item: decorateItem(item, plan, videoMap(), hidup),
      skipped: true,
      reason: 'Sudah terkirim sebelumnya'
    });
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
    boardId: item.boardId || boardFor(item.channelId),
    settings: appSettings.forChannel(item.channelId)
  });

  // Field wajib yang belum terisi dicegat di sini, sebelum request dikirim —
  // percuma membakar kuota untuk post yang pasti ditolak Buffer.
  if (missing.length || !text.trim()) {
    item.status = 'error';
    item.error = missing.length
      ? `Belum lengkap: ${missing.join(', ')}`
      : `Belum ada teks untuk ${item.channelLabel}. Generate caption dulu.`;
    writePlans(plans);
    return res.json({ item: decorateItem(item, plan, videoMap(), hidup), usage: buffer.usageSnapshot() });
  }

  // Buffer mengunduh video dari PUBLIC_BASE_URL. Kalau URL-nya tidak bisa
  // dibaca, post pasti ditolak — jadi dicek dulu supaya kuota tidak terbuang.
  const mediaCheck = await media.checkPublicUrl(video.filename);
  if (!mediaCheck.ok) {
    item.status = 'error';
    item.error = `Video tidak bisa diunduh Buffer: ${mediaCheck.reason}`;
    writePlans(plans);
    return res.json({ item: decorateItem(item, plan, videoMap(), hidup), mediaCheck, usage: buffer.usageSnapshot() });
  }

  const sekarang = req.body?.sekarang === true;
  let catatanKirim = null;

  try {
    const { post, mode, mundur } = await kirimKeBuffer({
      account: item.account,
      channelId: item.channelId,
      text,
      metadata,
      videoUrl: media.publicUrl(video.filename),
      dueAt: item.dueAt,
      sekarang
    });
    item.status = 'sent';
    item.bufferPostId = post.id;
    item.error = null;
    item.sentAt = new Date().toISOString();
    item.sentMode = mode;
    catatanKirim = mundur;
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
  }

  item.textLength = text.length;
  item.lengthWarning = warning;
  writePlans(plans);

  res.json({
    item: decorateItem(item, plan, videoMap(), hidup),
    catatan: catatanKirim,
    usage: buffer.usageSnapshot()
  });
}));

/**
 * Kirim ke Buffer, terjadwal atau langsung.
 *
 * `shareNow` ada di enum ShareMode milik Buffer, tapi belum pernah kita
 * buktikan dengan token asli. Karena itu kalau Buffer menolak modenya, post-nya
 * TIDAK dibiarkan gagal — dijadwalkan pada waktu paling awal yang diterima
 * Buffer, lalu kemundurannya dilaporkan apa adanya ke user. Lebih baik tayang
 * beberapa menit lagi daripada tidak tayang sama sekali.
 */
async function kirimKeBuffer({ account, channelId, text, metadata, videoUrl, dueAt, sekarang }) {
  const dasar = { account, channelId, text, metadata, videoUrl };

  if (!sekarang) {
    return { post: await buffer.createPost({ ...dasar, dueAt, mode: 'customScheduled' }), mode: 'customScheduled' };
  }

  try {
    return { post: await buffer.createPost({ ...dasar, mode: 'shareNow' }), mode: 'shareNow' };
  } catch (err) {
    // Hanya mundur kalau memang modenya yang ditolak, bukan isi post-nya.
    if (!/sharemode|share mode|sharenow|mode|enum|not supported|invalid value/i.test(err.message)) throw err;

    const post = await buffer.createPost({ ...dasar, dueAt: new Date().toISOString(), mode: 'customScheduled' });
    return {
      post,
      mode: 'customScheduled',
      mundur: 'Buffer menolak mode "kirim sekarang", jadi post dijadwalkan pada waktu paling awal ' +
        `yang diterima (sekitar 5 menit lagi). Pesan dari Buffer: ${err.message}`
    };
  }
}

/**
 * Tanya Buffer: post yang kita kirim sebenarnya jadi tayang atau tidak?
 *
 * createPost yang berhasil hanya berarti "diterima ke antrian". Buffer baru
 * mencoba menayangkan saat waktunya tiba, dan kalau jaringan tujuan menolak
 * (Pinterest paling sering), kegagalan itu tidak pernah sampai ke sini — item
 * kita tetap tertulis "terkirim" padahal di Buffer sudah merah.
 *
 * Nilai statusnya tidak ditebak: daftarnya diambil dari skema Buffer.
 */
router.post('/api/plan/:id/sync', asyncHandler(async (req, res) => {
  const { plans, plan } = findPlan(req.params.id);

  const dikirim = plan.items.filter((i) => i.bufferPostId);
  if (!dikirim.length) {
    return res.json({ diperiksa: 0, berubah: 0, catatan: ['Belum ada item yang pernah dikirim ke Buffer.'] });
  }

  // Daftar status diambil dari skema, bukan dihafal.
  let skema = store.read('metrics-schema', null);
  if (!skema?.postStatus?.length) {
    skema = await buffer.introspectMetrics();
    store.write('metrics-schema', skema);
  }

  const { byId, errors } = await buffer.postStatuses({ statuses: skema.postStatus });

  const catatan = [...errors];
  let berubah = 0;
  let hilang = 0;

  for (const item of dikirim) {
    const dariBuffer = byId.get(item.bufferPostId);

    if (!dariBuffer) {
      hilang++;
      continue;
    }

    const status = String(dariBuffer.status || '');
    item.bufferStatus = status;

    if (/error|fail|reject/i.test(status)) {
      if (item.status !== 'error') berubah++;
      item.status = 'error';
      item.error =
        `Buffer gagal menayangkannya ke ${item.platform} (status Buffer: "${status}"). ` +
        'Post-nya sempat masuk antrian, jadi masalahnya di langkah Buffer ke jaringan tujuan — ' +
        'bukan di data yang dikirim aplikasi ini.';
    } else if (status === 'sent' && item.status !== 'sent') {
      item.status = 'sent';
      item.error = null;
      berubah++;
    }
  }

  writePlans(plans);

  if (hilang) {
    catatan.push(
      `${hilang} post tidak ditemukan lagi di Buffer — kemungkinan sudah dihapus di sana, ` +
      'atau usianya di luar jangkauan pembacaan.'
    );
  }

  const hidup = await channelHidup();
  const items = plan.items.map((item) => decorateItem(item, plan, videoMap(), hidup));
  res.json({
    plan: { ...plan, items },
    ringkas: summarize(items, plan),
    diperiksa: dikirim.length,
    berubah,
    catatan,
    usage: buffer.usageSnapshot()
  });
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
    boardId: item.boardId || boardFor(item.channelId),
    settings: appSettings.forChannel(item.channelId)
  });
  res.json({ text, length: text.length, warning, metadata, missing });
}));

module.exports = router;
