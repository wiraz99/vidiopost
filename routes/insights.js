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

async function refreshCache() {
  const { posts, errors, reduced } = await buffer.sentPostsWithMetrics({ first: 100 });
  const cache = { fetchedAt: new Date().toISOString(), posts, errors, reduced };
  store.write('metrics-cache', cache);
  return cache;
}

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
  const diagnosa = [];
  const terpakai = new Set();

  for (const channel of channels) {
    const list = rows.filter((r) => r.channelId === channel.id);
    list.forEach((r) => terpakai.add(r.postId));
    diagnosa.push(ringkasChannel(channel.label, channel.platform, list));
  }
  // Post dari channel yang tidak ada di daftar (mis. sudah diputus di Buffer).
  const sisa = rows.filter((r) => !terpakai.has(r.postId));
  for (const [channelId, list] of groupBy(sisa, (r) => r.channelId)) {
    diagnosa.push({ ...ringkasChannel(list[0].channelLabel, list[0].platform, list), channelId, takDikenal: true });
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
  const bisu = diagnosa.filter((d) => d.sentCount > 0 && d.withMetrics === 0);
  if (bisu.length) {
    catatan.push(
      `Belum ada metrik sama sekali dari: ${bisu.map((d) => d.label).join(', ')}. ` +
      'Kalau post-nya sudah lebih dari sehari, kemungkinan jaringan itu memang belum ' +
      'melaporkan apa pun ke Buffer.'
    );
  }
  if (cache?.reduced) {
    catatan.push('Buffer menolak sebagian field baru, jadi dipakai query cadangan yang lebih sederhana.');
  }
  if (cache?.errors?.length) catatan.push(`Sebagian akun gagal dibaca: ${cache.errors.join('; ')}`);

  // ---------- pengelompokan ----------
  const byPlatform = [...groupBy(rows, (r) => r.platform)]
    .map(([platform, list]) => ({
      platform,
      postCount: list.length,
      withMetrics: list.filter((r) => r.metricCount > 0).length,
      metrics: aggregate(list)
    }))
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
    punyaAngka: berangka.length > 0,
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

function ringkasChannel(label, platform, list) {
  const keys = new Set();
  for (const row of list) for (const key of Object.keys(row.metrics)) keys.add(key);
  return {
    label,
    platform,
    sentCount: list.length,
    withMetrics: list.filter((r) => r.metricCount > 0).length,
    lastUpdate: list.map((r) => r.metricsUpdatedAt).filter(Boolean).sort().at(-1) || null,
    metrics: [...keys].sort((a, b) => orderOf(a) - orderOf(b)).map((k) => METRIC_LABEL[k] || k)
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
