/**
 * Insight performa konten.
 *
 * Aturan utama halaman ini: METRIK ANTAR PLATFORM TIDAK BISA DIJUMLAHKAN.
 *
 * Buffer menormalkan sebagian nama metrik, tapi tiap jaringan melaporkan hal
 * yang berbeda — Instagram punya `impressions` dan `saves`, YouTube punya
 * `views`, sebagian jaringan cuma melaporkan `reactions` dan `comments`.
 * Versi sebelumnya memilih SATU "metrik utama" per post lalu menjumlahkannya
 * lintas platform. Hasilnya menyesatkan: platform yang tidak melaporkan
 * views/impressions ikut terhitung dengan angka yang bukan sejenis, dan
 * platform yang belum melaporkan apa pun hilang begitu saja dari grafik.
 *
 * Sekarang tiap metrik dikumpulkan apa adanya per platform, dan yang tidak
 * dilaporkan ditampilkan sebagai "belum ada", bukan sebagai nol.
 *
 * Catatan penting dari dokumentasi Buffer:
 *   - metrik ditarik dari tiap jaringan SEKALI SEHARI
 *   - post baru butuh sampai ~24 jam sebelum metriknya muncul
 *   - metrik yang tidak ada BUKAN berarti nol, tapi belum dilaporkan
 *   - query metrics masih ditandai "experimental" oleh Buffer
 */
const express = require('express');
const store = require('../lib/store');
const buffer = require('../lib/buffer');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

const TTL_MS = Number(process.env.METRICS_TTL_MS || 6 * 60 * 60 * 1000); // 6 jam
const SEHARI_MS = 24 * 60 * 60 * 1000;

// Nama metrik yang dipakai Buffer, diterjemahkan seperlunya. Yang tidak ada di
// sini tetap tampil memakai nama dari Buffer sendiri — jangan sampai metrik
// baru hilang cuma karena belum sempat diterjemahkan.
const METRIC_LABEL = {
  postcount: 'Jumlah post',
  views: 'Views',
  impressions: 'Impresi',
  reach: 'Jangkauan',
  viewers: 'Penonton',
  reactions: 'Reaksi',
  likes: 'Suka',
  comments: 'Komentar',
  shares: 'Dibagikan',
  reposts: 'Repost',
  quotes: 'Quote',
  saves: 'Disimpan',
  follows: 'Follower baru',
  clicks: 'Klik',
  totaltimewatched: 'Total waktu ditonton',
  engagementrate: 'Eng. rate'
};

// Urutan tampil: jangkauan dulu, baru interaksi.
const METRIC_ORDER = [
  'views', 'impressions', 'reach', 'viewers',
  'reactions', 'likes', 'comments', 'shares', 'reposts', 'quotes', 'saves',
  'follows', 'clicks', 'totaltimewatched', 'engagementrate'
];

const normKey = (raw) => String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const orderOf = (key) => {
  const i = METRIC_ORDER.indexOf(key);
  return i === -1 ? METRIC_ORDER.length : i;
};

/** Metrik persen tidak boleh dijumlahkan — hanya dirata-rata. */
const isPercent = (unit, key) => /percent|rate/i.test(String(unit || '')) || key.endsWith('rate');

/**
 * Ubah array metrics dari Buffer jadi peta yang gampang dipakai.
 * Metrik yang nilainya null DIBUANG: menurut dokumentasi Buffer, metrik yang
 * tidak dilaporkan bukan berarti nol.
 */
function normalizeMetrics(raw) {
  const out = {};
  for (const m of raw || []) {
    if (m?.value == null) continue;
    const key = normKey(m.type || m.name);
    if (!key) continue;
    const value = Number(m.value);
    if (!Number.isFinite(value)) continue;
    out[key] = {
      key,
      label: METRIC_LABEL[key] || m.name || key,
      value,
      unit: m.unit || null,
      percent: isPercent(m.unit, key)
    };
  }
  return out;
}

/** Kumpulkan metrik dari sekumpulan post. Tiap metrik dihitung terpisah. */
function aggregate(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const m of Object.values(row.metrics)) {
      const acc = map.get(m.key) || {
        key: m.key, label: m.label, unit: m.unit, percent: m.percent, total: 0, count: 0
      };
      acc.total += m.value;
      acc.count++;
      map.set(m.key, acc);
    }
  }
  return [...map.values()]
    .map((a) => ({
      key: a.key,
      label: a.label,
      percent: a.percent,
      // Persen tidak punya arti kalau dijumlahkan, jadi sengaja tidak dikirim.
      total: a.percent ? null : a.total,
      average: a.count ? Math.round((a.total / a.count) * 100) / 100 : 0,
      count: a.count
    }))
    .sort((a, b) => orderOf(a.key) - orderOf(b.key));
}

// Jangan sampai satu penyegaran menghabiskan kuota harian gara-gara banyak
// channel diam sekaligus.
const MAX_AGREGAT = 6;

/**
 * Untuk channel yang punya post terkirim tapi TIDAK SATU PUN metrik per-post,
 * coba jalur kedua: query agregat. Balasannya selalu memuat postCount,
 * reactions dan comments, jadi hasilnya menjawab dua hal sekaligus —
 * apakah Buffer benar-benar melihat post itu, dan apakah ada angkanya.
 */
async function ambilAgregat(posts) {
  const perChannel = new Map();
  for (const post of posts) {
    if (!perChannel.has(post.channelId)) {
      perChannel.set(post.channelId, { account: post.account, adaMetrik: false, waktu: [] });
    }
    const entri = perChannel.get(post.channelId);
    if ((post.metrics || []).some((m) => m?.value != null)) entri.adaMetrik = true;
    const waktu = post.sentAt || post.dueAt;
    if (waktu) entri.waktu.push(new Date(waktu).getTime());
  }

  const bisu = [...perChannel.entries()].filter(([, e]) => !e.adaMetrik).slice(0, MAX_AGREGAT);
  const hasil = {};

  for (const [channelId, entri] of bisu) {
    // Rentangnya dilebarkan sehari di kedua ujung; batas atas Buffer 365 hari.
    const paling = entri.waktu.length ? Math.min(...entri.waktu) : Date.now() - 30 * SEHARI_MS;
    const mulai = Math.max(paling - SEHARI_MS, Date.now() - 364 * SEHARI_MS);
    try {
      const { metrics, metricsUpdatedAt } = await buffer.aggregatedMetrics({
        account: entri.account,
        channelIds: [channelId],
        startDateTime: new Date(mulai).toISOString(),
        endDateTime: new Date(Date.now() + SEHARI_MS).toISOString()
      });
      hasil[channelId] = { metrics, metricsUpdatedAt };
    } catch (err) {
      hasil[channelId] = { error: err.message, metrics: [] };
    }
  }
  return hasil;
}

async function refreshCache() {
  const { posts, errors, reduced } = await buffer.sentPostsWithMetrics({ first: 100 });
  const agregat = await ambilAgregat(posts);
  const cache = { fetchedAt: new Date().toISOString(), posts, errors, reduced, agregat };
  store.write('metrics-cache', cache);
  return cache;
}

/**
 * Kemampuan API Buffer, ditanyakan langsung ke servernya.
 *
 * Dipakai untuk menjawab "kok platform X tidak ada angkanya" secara tuntas:
 * kalau sebuah metrik DIKENAL API tapi tidak pernah kita terima untuk platform
 * itu, berarti jaringannya yang tidak melaporkan — bukan query kita yang salah
 * atau field yang belum kita minta.
 *
 * Skema jarang berubah, jadi hasilnya disimpan dan hanya diambil ulang kalau
 * diminta. Biayanya satu request.
 */
router.get('/api/insights/skema', asyncHandler(async (req, res) => {
  if (!buffer.anyToken()) {
    return res.json({ ada: false, alasan: 'Token Buffer belum diisi.' });
  }

  let skema = store.read('metrics-schema', null);
  let error = null;

  if (req.query.refresh === '1' || !skema) {
    try {
      skema = await buffer.introspectMetrics();
      store.write('metrics-schema', skema);
    } catch (err) {
      error = err.message;
    }
  }

  if (!skema) return res.json({ ada: false, alasan: error || 'Skema belum pernah diambil.', error });

  // Apa yang BENAR-BENAR pernah kita terima, dikelompokkan per platform.
  const cache = store.read('metrics-cache', null);
  const diterima = {};
  const semuaTerpakai = new Set();

  // Akun yang memakai query cadangan tidak mengirim channelService, jadi
  // platformnya dicari lewat daftar channel — sama seperti rute utama.
  const { channels } = await buffer.discoverChannels().catch(() => ({ channels: [] }));
  const platformById = new Map(channels.map((c) => [c.id, c.platform]));

  for (const post of cache?.posts || []) {
    const platform = normKey(post.channelService) || platformById.get(post.channelId) || 'lainnya';
    if (!diterima[platform]) diterima[platform] = new Set();
    for (const m of post.metrics || []) {
      if (m?.value == null) continue;
      const key = normKey(m.type || m.name);
      if (!key) continue;
      diterima[platform].add(key);
      semuaTerpakai.add(key);
    }
  }

  const dikenal = skema.tipeMetrik.map((t) => ({ ...t, kunci: normKey(t.nama) }));

  res.json({
    ada: true,
    error,
    skema: { diperiksaPada: skema.diperiksaPada, satuan: skema.satuan, postFields: skema.postFields },
    dikenal,
    diterima: Object.fromEntries(Object.entries(diterima).map(([p, s]) => [p, [...s]])),
    // Metrik yang API-nya kenal tapi belum pernah sampai ke kita dari mana pun.
    belumPernahDiterima: dikenal.filter((t) => !semuaTerpakai.has(t.kunci)).map((t) => t.nama),
    usage: buffer.usageSnapshot()
  });
}));

router.get('/api/insights', asyncHandler(async (req, res) => {
  const usage = buffer.usageSnapshot();

  if (!buffer.anyToken()) {
    return res.json({
      available: false,
      reason: 'Token Buffer belum diisi, jadi belum ada data yang bisa diambil.',
      needsToken: true,
      usage
    });
  }

  let cache = store.read('metrics-cache', null);
  const stale = !cache || Date.now() - new Date(cache.fetchedAt).getTime() > TTL_MS;

  let refreshError = null;
  if (req.query.refresh === '1' || stale) {
    try {
      cache = await refreshCache();
    } catch (err) {
      refreshError = err.message;
      if (!cache) {
        return res.json({
          available: false,
          reason: `Tidak bisa mengambil data dari Buffer: ${err.message}`,
          usage
        });
      }
    }
  }

  const rawPosts = cache?.posts || [];
  const { channels } = await buffer.discoverChannels().catch(() => ({ channels: [] }));

  if (!rawPosts.length) {
    return res.json({
      available: false,
      reason: 'Belum ada post berstatus "sent" di Buffer, jadi belum ada yang bisa diukur.',
      fetchedAt: cache?.fetchedAt,
      refreshError,
      fetchErrors: cache?.errors || [],
      usage
    });
  }

  // ---------- sambungkan ke data lokal ----------
  const plans = store.read('plans', []);
  const videos = store.read('videos', []);
  const sets = store.read('hashtags', []);

  const itemByPostId = new Map();
  for (const plan of plans) {
    for (const item of plan.items || []) {
      if (item.bufferPostId) itemByPostId.set(item.bufferPostId, { item, plan });
    }
  }
  const channelById = new Map(channels.map((c) => [c.id, c]));

  const rows = rawPosts.map((post) => {
    const link = itemByPostId.get(post.id);
    const video = link ? videos.find((v) => v.id === link.item.videoId) : null;
    const channel = channelById.get(post.channelId);
    const metrics = normalizeMetrics(post.metrics);

    return {
      postId: post.id,
      channelId: post.channelId,
      channelLabel: channel?.label || post.channelId,
      // Platform diambil dari post-nya sendiri; daftar channel cuma cadangan.
      platform: normKey(post.channelService) || channel?.platform || 'lainnya',
      sentAt: post.sentAt || post.dueAt || null,
      externalLink: post.externalLink || null,
      metricsUpdatedAt: post.metricsUpdatedAt || null,
      videoId: video?.id || null,
      title: video?.title || (post.text || '').split('\n')[0].slice(0, 70) || '(tanpa judul)',
      hashtagSetIds: link?.plan?.hashtagSetIds || [],
      metrics,
      metricCount: Object.keys(metrics).length
    };
  });

  const berangka = rows.filter((r) => r.metricCount > 0);

  // ---------- diagnosa per channel: ini yang menjawab "kok platform X kosong" ----------

  // Balasan mentah Buffer untuk satu post tiap channel. Ditampilkan apa adanya
  // di halaman supaya pertanyaan "sebenarnya Buffer bilang apa" tidak pernah
  // lagi jadi tebak-tebakan yang butuh akses terminal.
  const mentahPer = new Map();
  for (const post of rawPosts) {
    if (mentahPer.has(post.channelId)) continue;
    mentahPer.set(post.channelId, {
      postId: post.id,
      metrics: post.metrics === undefined ? '(field tidak ada)' : post.metrics,
      metricsUpdatedAt: post.metricsUpdatedAt ?? null
    });
  }

  const agregatCache = cache?.agregat || {};
  const diagnosa = [];
  const terpakai = new Set();

  for (const channel of channels) {
    const list = rows.filter((r) => r.channelId === channel.id);
    list.forEach((r) => terpakai.add(r.postId));
    diagnosa.push(ringkasChannel(channel.id, channel.label, channel.platform, list, {
      agregat: agregatCache[channel.id],
      mentah: mentahPer.get(channel.id)
    }));
  }
  // Post dari channel yang tidak ada di daftar (mis. sudah diputus di Buffer).
  const sisa = rows.filter((r) => !terpakai.has(r.postId));
  for (const [channelId, list] of groupBy(sisa, (r) => r.channelId)) {
    diagnosa.push({
      ...ringkasChannel(channelId, list[0].channelLabel, list[0].platform, list, {
        agregat: agregatCache[channelId],
        mentah: mentahPer.get(channelId)
      }),
      takDikenal: true
    });
  }

  // ---------- catatan yang perlu dibaca sebelum menyimpulkan ----------
  const catatan = [];
  const baru = rows.filter((r) => r.sentAt && Date.now() - new Date(r.sentAt).getTime() < SEHARI_MS);
  if (baru.length) {
    catatan.push(
      `${baru.length} post terkirim kurang dari 24 jam lalu. Buffer menarik metrik dari tiap ` +
      'jaringan sekali sehari, jadi angkanya wajar kalau belum muncul.'
    );
  }
  // Channel yang diam dijelaskan satu per satu — "belum ada metrik" saja tidak
  // memberi tahu apakah masalahnya di Buffer, di jaringannya, atau cuma
  // belum lewat 24 jam. Jawabannya datang dari query agregat.
  for (const d of diagnosa.filter((x) => x.sentCount > 0 && x.withMetrics === 0)) {
    const a = d.agregat;
    if (!a) {
      catatan.push(
        `${d.label}: ${d.sentCount} post terkirim tapi belum ada metrik. Tekan ` +
        '"Ambil data terbaru" supaya diperiksa lewat jalur agregat Buffer.'
      );
    } else if (a.error) {
      catatan.push(`${d.label}: pemeriksaan agregat gagal — ${a.error}`);
    } else if (a.adaAngka) {
      catatan.push(
        `${d.label}: metrik per-post kosong, tapi ringkasan agregat Buffer ada angkanya. ` +
        'Angka itulah yang dipakai di kartu platform.'
      );
    } else if (a.postCount > 0) {
      catatan.push(
        `${d.label}: Buffer melihat ${a.postCount} post di channel ini, tapi semua angkanya nol. ` +
        'Jaringan ini memang tidak melaporkan reaksi/komentar ke Buffer — bukan setelan yang salah ' +
        'di aplikasi ini.'
      );
    } else {
      catatan.push(
        `${d.label}: query agregat tidak menemukan satu pun post di rentang ini, padahal daftar ` +
        `post terkirim memuat ${d.sentCount}. Datanya belum sinkron di sisi Buffer.`
      );
    }
  }
  if (cache?.reduced) {
    catatan.push('Buffer menolak sebagian field baru, jadi dipakai query cadangan yang lebih sederhana.');
  }
  if (cache?.errors?.length) catatan.push(`Sebagian akun gagal dibaca: ${cache.errors.join('; ')}`);

  // ---------- pengelompokan ----------
  const byPlatform = [...groupBy(rows, (r) => r.platform)]
    .map(([platform, list]) => {
      const channelIds = [...new Set(list.map((r) => r.channelId))];
      return {
        platform,
        postCount: list.length,
        withMetrics: list.filter((r) => r.metricCount > 0).length,
        metrics: aggregate(list),
        // Cadangan untuk platform yang metrik per-postnya tidak pernah terisi.
        agregat: gabungAgregat(channelIds.map((id) => diagnosa.find((d) => d.channelId === id)?.agregat))
      };
    })
    .sort((a, b) => b.withMetrics - a.withMetrics || b.postCount - a.postCount);

  // Satu video tayang di beberapa channel — inilah perbandingan yang paling
  // berguna untuk pola rotasi: video mana yang jalan, dan di platform mana.
  //
  // Platform yang belum punya angka tetap ikut ditampilkan. Menyaringnya keluar
  // justru menyembunyikan hal yang paling ingin diketahui ("kok TikTok tidak
  // ada?") dan bikin hitungan channel di kartu tidak cocok dengan kenyataan.
  const byVideo = [...groupBy(rows.filter((r) => r.videoId), (r) => r.videoId)]
    .map(([videoId, list]) => ({
      videoId,
      title: list[0].title,
      postCount: list.length,
      withMetrics: list.filter((r) => r.metricCount > 0).length,
      perPlatform: [...groupBy(list, (r) => r.platform)]
        .map(([platform, sub]) => ({
          platform,
          channelLabel: sub[0].channelLabel,
          metrics: aggregate(sub)
        }))
        // yang ada angkanya dulu, yang kosong di bawah
        .sort((a, b) => b.metrics.length - a.metrics.length || a.platform.localeCompare(b.platform))
    }))
    .filter((v) => v.withMetrics > 0)
    .sort((a, b) => b.withMetrics - a.withMetrics || b.postCount - a.postCount);

  const setName = (id) => sets.find((s) => s.id === id)?.name || id;
  const byHashtagSet = [];
  const perSet = new Map();
  for (const row of berangka) {
    for (const id of row.hashtagSetIds) {
      if (!perSet.has(id)) perSet.set(id, []);
      perSet.get(id).push(row);
    }
  }
  for (const [id, list] of perSet) {
    byHashtagSet.push({ key: id, name: setName(id), postCount: list.length, metrics: aggregate(list) });
  }

  // Metrik apa saja yang benar-benar tersedia — dipakai frontend untuk
  // menyusun tombol pengurut, jadi tidak ada tombol untuk metrik kosong.
  const tersedia = aggregate(berangka).map((m) => ({ key: m.key, label: m.label, percent: m.percent }));

  res.json({
    available: true,
    // Angka dari jalur agregat ikut dihitung "ada" — kalau tidak, halaman
    // menutup diri padahal ada data yang bisa ditampilkan.
    punyaAngka: berangka.length > 0 || byPlatform.some((p) => p.agregat?.adaAngka),
    fetchedAt: cache.fetchedAt,
    ttlHours: TTL_MS / 3600000,
    refreshError,
    catatan,
    diagnosa,
    metrics: tersedia,
    ringkas: {
      totalPost: rows.length,
      berangka: berangka.length,
      platform: byPlatform.length,
      terakhirDiperbarui: rows
        .map((r) => r.metricsUpdatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null
    },
    byPlatform,
    byVideo,
    byHashtagSet,
    posts: rows,
    usage
  });
}));

function ringkasChannel(channelId, label, platform, list, extra = {}) {
  const keys = new Set();
  for (const row of list) for (const key of Object.keys(row.metrics)) keys.add(key);
  return {
    channelId,
    label,
    platform,
    sentCount: list.length,
    withMetrics: list.filter((r) => r.metricCount > 0).length,
    lastUpdate: list.map((r) => r.metricsUpdatedAt).filter(Boolean).sort().at(-1) || null,
    metrics: [...keys].sort((a, b) => orderOf(a) - orderOf(b)).map((k) => METRIC_LABEL[k] || k),
    agregat: ringkasAgregat(extra.agregat),
    mentah: extra.mentah || null
  };
}

/**
 * Rapikan hasil query agregat. `postCount` dipisah dari metrik lain karena
 * dia menjawab pertanyaan yang berbeda: apakah Buffer melihat post-nya sama
 * sekali, terlepas dari ada tidaknya angka performa.
 */
function ringkasAgregat(entri) {
  if (!entri) return null;
  if (entri.error) return { error: entri.error };

  const semua = normalizeMetrics(entri.metrics);
  const postCount = semua.postcount ? semua.postcount.value : null;
  delete semua.postcount;

  const daftar = Object.values(semua).sort((a, b) => orderOf(a.key) - orderOf(b.key));
  return {
    postCount,
    metrics: daftar.map((m) => ({ key: m.key, label: m.label, value: m.value })),
    adaAngka: daftar.some((m) => m.value > 0),
    metricsUpdatedAt: entri.metricsUpdatedAt || null
  };
}

/** Gabungkan hasil agregat beberapa channel jadi satu untuk kartu platform. */
function gabungAgregat(daftar) {
  const map = new Map();
  let postCount = 0;
  let ada = false;

  for (const a of daftar) {
    if (!a || a.error) continue;
    ada = true;
    postCount += a.postCount || 0;
    for (const m of a.metrics) {
      const acc = map.get(m.key) || { key: m.key, label: m.label, value: 0 };
      acc.value += m.value;
      map.set(m.key, acc);
    }
  }
  if (!ada) return null;

  return {
    postCount,
    metrics: [...map.values()].sort((a, b) => orderOf(a.key) - orderOf(b.key)),
    adaAngka: [...map.values()].some((m) => m.value > 0)
  };
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (key == null) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

module.exports = router;
