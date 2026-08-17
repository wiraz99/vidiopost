/**
 * Insight performa konten.
 *
 * PENTING: ketersediaan metrics di paket Buffer Free belum terbukti (lihat
 * scripts/probe-buffer.js). Endpoint ini sengaja dibuat "jujur": kalau Buffer
 * tidak mengembalikan angka, dia bilang apa adanya lewat field `available`
 * dan `reason`, bukan menampilkan grafik kosong yang menyesatkan.
 *
 * Rate limit paket Free cuma 250 request/hari, jadi hasilnya di-cache dan
 * hanya di-refresh kalau sudah basi atau diminta paksa.
 */
const express = require('express');
const store = require('../lib/store');
const buffer = require('../lib/buffer');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

const TTL_MS = Number(process.env.METRICS_TTL_MS || 6 * 60 * 60 * 1000); // 6 jam

// Metrik yang dipakai sebagai angka utama, urut dari yang paling disukai.
const PRIMARY_PREFERENCE = ['views', 'impressions', 'reach', 'plays', 'clicks'];

const numberOf = (metrics, name) => {
  const m = (metrics || []).find((x) => String(x.type || x.name).toLowerCase() === name);
  return m && m.value != null ? Number(m.value) : null;
};

function primaryMetric(metrics) {
  for (const name of PRIMARY_PREFERENCE) {
    const value = numberOf(metrics, name);
    if (value != null) return { name, value };
  }
  const first = (metrics || []).find((m) => m.value != null);
  return first ? { name: String(first.type || first.name).toLowerCase(), value: Number(first.value) } : null;
}

async function refreshCache() {
  const { posts, errors } = await buffer.sentPostsWithMetrics({ first: 50 });
  const cache = { fetchedAt: new Date().toISOString(), posts, errors };
  store.write('metrics-cache', cache);
  return cache;
}

router.get('/api/insights', asyncHandler(async (req, res) => {
  if (!buffer.anyToken()) {
    return res.json({
      available: false,
      reason: 'Token Buffer belum diisi di .env, jadi belum ada data yang bisa diambil.',
      needsToken: true,
      usage: buffer.usageSnapshot()
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
          usage: buffer.usageSnapshot()
        });
      }
    }
  }

  const posts = cache?.posts || [];
  const withValues = posts.filter((p) => (p.metrics || []).some((m) => m.value != null));

  if (!posts.length) {
    return res.json({
      available: false,
      reason: 'Belum ada post berstatus "sent" di Buffer, jadi belum ada yang bisa diukur.',
      fetchedAt: cache?.fetchedAt,
      refreshError,
      usage: buffer.usageSnapshot()
    });
  }
  if (!withValues.length) {
    return res.json({
      available: false,
      reason:
        `Ada ${posts.length} post terkirim, tapi Buffer mengembalikan metrik kosong. ` +
        'Kemungkinan besar analytics dikunci di paket Free.',
      fetchedAt: cache?.fetchedAt,
      refreshError,
      usage: buffer.usageSnapshot()
    });
  }

  // --- gabungkan dengan data lokal supaya tahu video & set hashtag mana ---
  const plans = store.read('plans', []);
  const videos = store.read('videos', []);
  const { channels } = await buffer.discoverChannels().catch(() => ({ channels: [] }));

  const itemByPostId = new Map();
  for (const plan of plans) {
    for (const item of plan.items || []) {
      if (item.bufferPostId) itemByPostId.set(item.bufferPostId, { item, plan });
    }
  }

  const rows = withValues.map((post) => {
    const link = itemByPostId.get(post.id);
    const video = link ? videos.find((v) => v.id === link.item.videoId) : null;
    const channel = channels.find((c) => c.id === post.channelId);
    const primary = primaryMetric(post.metrics);

    return {
      postId: post.id,
      channelId: post.channelId,
      channelLabel: channel?.label || post.channelId,
      platform: channel?.platform || '',
      dueAt: post.dueAt,
      videoId: video?.id || null,
      title: video?.title || (post.text || '').split('\n')[0].slice(0, 60) || '(tanpa judul)',
      hashtagSetIds: link?.plan?.hashtagSetIds || [],
      primary,
      metrics: post.metrics
    };
  });

  const sumBy = (keyFn) => {
    const map = new Map();
    for (const row of rows) {
      if (!row.primary) continue;
      for (const key of [].concat(keyFn(row))) {
        if (!key) continue;
        const acc = map.get(key) || { key, total: 0, count: 0 };
        acc.total += row.primary.value;
        acc.count++;
        map.set(key, acc);
      }
    }
    return [...map.values()]
      .map((a) => ({ ...a, average: Math.round(a.total / a.count) }))
      .sort((a, b) => b.total - a.total);
  };

  const sets = store.read('hashtags', []);
  const setName = (id) => sets.find((s) => s.id === id)?.name || id;

  res.json({
    available: true,
    fetchedAt: cache.fetchedAt,
    refreshError,
    ttlHours: TTL_MS / 3600000,
    metricName: rows.find((r) => r.primary)?.primary.name || 'views',
    posts: rows.sort((a, b) => (b.primary?.value || 0) - (a.primary?.value || 0)),
    byPlatform: sumBy((r) => r.platform),
    byHashtagSet: sumBy((r) => r.hashtagSetIds).map((a) => ({ ...a, name: setName(a.key) })),
    usage: buffer.usageSnapshot()
  });
}));

module.exports = router;
