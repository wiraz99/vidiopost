/**
 * Klien Buffer GraphQL API.  https://developers.buffer.com/reference.html
 *
 * Dua hal yang dijaga di sini:
 *  1. RATE LIMIT. Paket Free cuma 100/15menit, 250/24jam, 3000/30hari. Tiap request
 *     dihitung dan disimpan; kalau mepet batas, request ditolak lebih awal supaya
 *     akun tidak terkunci di tengah pengiriman jadwal.
 *  2. KETIDAKPASTIAN SKEMA. Sebagian nama field belum terverifikasi dengan token asli
 *     (lihat scripts/probe-buffer.js). Karena itu discoverChannels() selalu punya
 *     jalan mundur ke channels.json kalau query-nya gagal.
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const store = require('./store');

// Bisa ditimpa lewat env supaya pemakaian kuota bisa diukur dengan
// Buffer tiruan, tanpa membakar jatah request yang asli.
const ENDPOINT = process.env.BUFFER_ENDPOINT || 'https://api.buffer.com/graphql';

const TOKENS = {
  A: process.env.BUFFER_TOKEN_A || '',
  B: process.env.BUFFER_TOKEN_B || ''
};

// Batas paket Free, disisakan margin supaya tidak mentok pas.
const LIMIT_24H = Number(process.env.BUFFER_LIMIT_24H || 250);
const LIMIT_15M = Number(process.env.BUFFER_LIMIT_15M || 100);
const SAFETY_MARGIN = 10;

const CHANNEL_CACHE_TTL_MS = Number(process.env.CHANNEL_CACHE_TTL_MS || 60 * 60 * 1000);
const SCHEDULED_CACHE_TTL_MS = Number(process.env.SCHEDULED_CACHE_TTL_MS || 5 * 60 * 1000);
const BOARDS_CACHE_TTL_MS = Number(process.env.BOARDS_CACHE_TTL_MS || 10 * 60 * 1000);

class BufferError extends Error {
  constructor(message, { code = 'BUFFER_ERROR', status = 502 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------------- penghitung pemakaian ----------------

function loadUsage() {
  const u = store.read('buffer-usage', { day: '', dayCount: 0, recent: [] });
  const today = new Date().toISOString().slice(0, 10);
  if (u.day !== today) {
    u.day = today;
    u.dayCount = 0;
  }
  const cutoff = Date.now() - 15 * 60 * 1000;
  u.recent = (u.recent || []).filter((t) => t > cutoff);
  return u;
}

function checkBudget(n = 1) {
  const u = loadUsage();
  if (u.dayCount + n > LIMIT_24H - SAFETY_MARGIN) {
    throw new BufferError(
      `Kuota harian Buffer hampir habis (${u.dayCount}/${LIMIT_24H} request hari ini). ` +
      'Tunggu sampai besok atau kurangi jumlah post.',
      { code: 'RATE_BUDGET_DAY', status: 429 }
    );
  }
  if (u.recent.length + n > LIMIT_15M - SAFETY_MARGIN) {
    throw new BufferError(
      `Terlalu banyak request ke Buffer dalam 15 menit terakhir (${u.recent.length}/${LIMIT_15M}). ` +
      'Tunggu beberapa menit.',
      { code: 'RATE_BUDGET_15M', status: 429 }
    );
  }
  return u;
}

function recordUsage(n = 1) {
  const u = loadUsage();
  u.dayCount += n;
  const now = Date.now();
  for (let i = 0; i < n; i++) u.recent.push(now);
  store.write('buffer-usage', u);
  return u;
}

function usageSnapshot() {
  const u = loadUsage();
  const scheduled = store.read('scheduled-cache', null);
  const channels = store.read('channels-cache', null);
  const ageMin = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);
  return {
    cache: {
      antrianUmurMenit: ageMin(scheduled?.fetchedAt),
      channelUmurMenit: ageMin(channels?.fetchedAt),
      antrianTtlMenit: Math.round(SCHEDULED_CACHE_TTL_MS / 60000),
      channelTtlMenit: Math.round(CHANNEL_CACHE_TTL_MS / 60000)
    },
    day: u.day,
    dayCount: u.dayCount,
    dayLimit: LIMIT_24H,
    last15m: u.recent.length,
    limit15m: LIMIT_15M
  };
}

// ---------------- transport ----------------

function tokenFor(account) {
  const token = TOKENS[account];
  if (!token) {
    throw new BufferError(`Token Buffer untuk akun ${account} belum diisi di .env`, {
      code: 'NO_TOKEN',
      status: 500
    });
  }
  return token;
}

async function gql(account, query, variables) {
  const token = tokenFor(account);
  checkBudget(1);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables })
    });
  } finally {
    // Dihitung walau gagal — request tetap terkirim dan tetap memakan kuota.
    recordUsage(1);
  }

  if (res.status === 401 || res.status === 403) {
    throw new BufferError(`Token Buffer akun ${account} ditolak (HTTP ${res.status}).`, {
      code: 'UNAUTHORIZED',
      status: 401
    });
  }
  if (res.status === 429) {
    throw new BufferError('Buffer menolak karena rate limit (HTTP 429). Coba lagi nanti.', {
      code: 'RATE_LIMITED',
      status: 429
    });
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BufferError(`Respons Buffer bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (body.errors?.length) {
    throw new BufferError(body.errors.map((e) => e.message).join(' | '), { code: 'GRAPHQL_ERROR' });
  }
  return body.data;
}

// ---------------- organisasi ----------------

const orgCache = {};

/**
 * organizationId tidak pernah berubah, jadi disimpan ke disk — bukan cuma di
 * memori. Cache memori hilang tiap restart/redeploy, dan dulu itu berarti
 * dua request terbuang percuma setiap kali aplikasi dinyalakan ulang.
 */
async function organizationId(account) {
  if (orgCache[account]) return orgCache[account];

  const stored = store.read('org-cache', {});
  if (stored[account]) {
    orgCache[account] = stored[account];
    return stored[account];
  }

  const data = await gql(account, `query { account { organizations { id name } } }`);
  const orgs = data?.account?.organizations || [];
  if (!orgs.length) {
    throw new BufferError(`Akun Buffer ${account} tidak punya organisasi.`, { code: 'NO_ORG' });
  }

  orgCache[account] = orgs[0].id;
  stored[account] = orgs[0].id;
  store.write('org-cache', stored);
  return orgCache[account];
}

// ---------------- channel ----------------

const CHANNELS_QUERY = `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      service
      name
    }
  }`;

const CHANNELS_FILE = process.env.CHANNELS_FILE || path.join(__dirname, '..', 'channels.json');

function channelsFromFile() {
  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    const list = JSON.parse(raw);
    // ID placeholder ("GANTI_...") tidak dianggap channel sungguhan.
    return list.filter((c) => c.id && !/^GANTI/i.test(c.id));
  } catch {
    return [];
  }
}

/**
 * Daftar channel gabungan dari kedua akun Buffer.
 * Format dipertahankan sama seperti channels.json: { id, platform, label, account }.
 *
 * Urutan usaha: cache → API → channels.json.
 */
async function discoverChannels({ force = false } = {}) {
  const cached = store.read('channels-cache', null);
  if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < CHANNEL_CACHE_TTL_MS) {
    return { channels: cached.channels, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  const overrides = channelsFromFile();
  const byId = new Map(overrides.map((c) => [c.id, c]));
  const found = [];
  const errors = [];

  for (const account of ['A', 'B']) {
    if (!TOKENS[account]) continue;
    try {
      const orgId = await organizationId(account);
      const data = await gql(account, CHANNELS_QUERY, { organizationId: orgId });
      for (const c of data?.channels || []) {
        const override = byId.get(c.id);
        found.push({
          id: c.id,
          platform: (override?.platform || c.service || 'unknown').toLowerCase(),
          label: override?.label || c.name || c.service || c.id,
          account
        });
      }
    } catch (err) {
      errors.push(`akun ${account}: ${err.message}`);
    }
  }

  if (!found.length) {
    if (overrides.length) {
      return { channels: overrides, source: 'channels.json', errors };
    }
    throw new BufferError(
      errors.length
        ? `Gagal membaca channel dari Buffer (${errors.join('; ')}) dan channels.json belum diisi.`
        : 'Token Buffer belum diisi dan channels.json belum berisi channel.',
      { code: 'NO_CHANNELS', status: 500 }
    );
  }

  const fetchedAt = new Date().toISOString();
  store.write('channels-cache', { fetchedAt, channels: found });
  return { channels: found, source: 'api', fetchedAt, errors };
}

// ---------------- board Pinterest ----------------

// Board ada di channel.metadata, BUKAN di subtipe channel.
// https://developers.buffer.com/types/PinterestPostMetadataInput.html
const BOARDS_QUERY = `
  query ChannelBoards($id: ChannelId!) {
    channel(input: { id: $id }) {
      id
      name
      metadata {
        ... on PinterestMetadata {
          boards { serviceId name }
        }
      }
    }
  }`;

// Sebagian akun tidak punya field `name` di board; ini cadangannya.
const BOARDS_QUERY_MINIMAL = `
  query ChannelBoards($id: ChannelId!) {
    channel(input: { id: $id }) {
      id
      metadata {
        ... on PinterestMetadata {
          boards { serviceId }
        }
      }
    }
  }`;

/**
 * Daftar board Pinterest sebuah channel.
 *
 * Di-cache karena jarang berubah, TAPI dengan dua pengaman:
 *  - punya masa berlaku, supaya board yang baru dibuat tetap muncul
 *  - hasil KOSONG tidak pernah disimpan; kalau tidak, sekali dibaca sebelum
 *    boardnya ada, daftar kosong itu akan terkunci selamanya
 */
async function channelBoards(account, channelId, { force = false } = {}) {
  const cacheKey = 'boards-cache';
  const cached = store.read(cacheKey, {});
  const entry = cached[channelId];

  if (!force && entry?.boards?.length && Date.now() - new Date(entry.fetchedAt).getTime() < BOARDS_CACHE_TTL_MS) {
    return entry.boards;
  }

  let data;
  try {
    data = await gql(account, BOARDS_QUERY, { id: channelId });
  } catch (err) {
    // Kalau `name` tidak ada di skema, coba lagi tanpa field itu.
    if (/name/i.test(err.message)) data = await gql(account, BOARDS_QUERY_MINIMAL, { id: channelId });
    else throw err;
  }

  const boards = (data?.channel?.metadata?.boards || []).map((b) => ({
    id: b.serviceId,
    name: b.name || b.serviceId
  }));

  // Hanya simpan kalau benar-benar ada isinya.
  if (boards.length) {
    cached[channelId] = { fetchedAt: new Date().toISOString(), boards };
    store.write(cacheKey, cached);
  }
  return boards;
}

// ---------------- antrian ----------------

const SCHEDULED_QUERY = `
  query Scheduled($organizationId: OrganizationId!, $first: Int!) {
    posts(first: $first, input: {
      organizationId: $organizationId
      filter: { status: [scheduled] }
    }) {
      edges { node { id channelId dueAt status } }
      pageInfo { hasNextPage }
    }
  }`;

/**
 * Jumlah post yang sedang mengantre, per channelId — dibaca dari Buffer.
 *
 * WAJIB di-cache. Dulu tidak, dan akibatnya setiap pratinjau jadwal menembak
 * Buffer: satu centang channel = 2 request. Mencentang-centang beberapa kali
 * saja sudah menghabiskan puluhan request dari jatah 250 per hari.
 */
async function scheduledCounts({ force = false, maxAgeMs = SCHEDULED_CACHE_TTL_MS } = {}) {
  const cached = store.read('scheduled-cache', null);
  if (!force && cached?.fetchedAt) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < maxAgeMs) return { ...cached, cached: true, ageMs: age };
  }

  const counts = {};
  const posts = [];
  const errors = [];

  for (const account of ['A', 'B']) {
    if (!TOKENS[account]) continue;
    try {
      const orgId = await organizationId(account);
      const data = await gql(account, SCHEDULED_QUERY, { organizationId: orgId, first: 100 });
      for (const edge of data?.posts?.edges || []) {
        const node = edge.node;
        posts.push(node);
        counts[node.channelId] = (counts[node.channelId] || 0) + 1;
      }
    } catch (err) {
      errors.push(`akun ${account}: ${err.message}`);
    }
  }

  const result = { fetchedAt: new Date().toISOString(), counts, posts, errors };
  // Hasil gagal total tidak disimpan, supaya tidak mengunci error selama 5 menit.
  if (!errors.length || posts.length) store.write('scheduled-cache', result);
  return { ...result, cached: false, ageMs: 0 };
}

/**
 * Naikkan hitungan antrian satu channel tanpa menembak Buffer lagi.
 * Dipanggil setelah post berhasil dibuat — lebih hemat daripada membuang
 * cache lalu memuat ulang (yang berarti 2 request tambahan).
 */
function bumpScheduled(channelId) {
  const cached = store.read('scheduled-cache', null);
  if (!cached?.counts) return;
  cached.counts[channelId] = (cached.counts[channelId] || 0) + 1;
  store.write('scheduled-cache', cached);
}

// ---------------- kirim post ----------------

const CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id dueAt status } }
      ... on MutationError { message }
    }
  }`;

/**
 * Buat satu post.
 * mode: 'addToQueue' (ikut slot otomatis Buffer) | 'customScheduled' (butuh dueAt ISO UTC)
 *
 * Buffer bisa membalas HTTP 200 dengan MutationError di dalamnya, jadi hasilnya
 * selalu diperiksa isinya, bukan cuma status HTTP-nya.
 */
async function createPost({ account, channelId, text, videoUrl, dueAt, mode = 'addToQueue', metadata = null }) {
  const input = {
    text,
    channelId,
    schedulingType: 'automatic',
    mode,
    assets: videoUrl ? [{ video: { url: videoUrl } }] : []
  };
  // Field wajib khusus platform (tipe Instagram, judul+kategori YouTube,
  // board Pinterest). Tanpa ini Buffer menolak dengan "Invalid post: ...".
  if (metadata) input.metadata = metadata;

  if (mode === 'customScheduled') {
    if (!dueAt) throw new BufferError('mode customScheduled butuh dueAt', { status: 400 });
    // Buffer menolak jadwal yang sudah lewat. Beri jarak aman kalau waktunya
    // sudah mepet atau terlewat — lebih baik mundur beberapa menit daripada gagal.
    const target = new Date(dueAt).getTime();
    const soonest = Date.now() + 5 * 60 * 1000;
    input.dueAt = new Date(Math.max(target, soonest)).toISOString();
  }

  const data = await gql(account, CREATE_POST, { input });
  const result = data?.createPost;

  if (result?.message) {
    throw new BufferError(result.message, { code: 'REJECTED_BY_BUFFER' });
  }
  if (!result?.post?.id) {
    throw new BufferError('Buffer tidak mengembalikan post — kemungkinan ditolak diam-diam.', {
      code: 'NO_POST_RETURNED'
    });
  }

  bumpScheduled(channelId);
  return result.post;
}

// ---------------- metrics ----------------

const SENT_WITH_METRICS = `
  query SentWithMetrics($organizationId: OrganizationId!, $first: Int!) {
    posts(first: $first, input: {
      organizationId: $organizationId
      filter: { status: [sent] }
    }) {
      edges {
        node {
          id
          channelId
          text
          dueAt
          metricsUpdatedAt
          metrics { type name value unit }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;

/** Post terkirim beserta metriknya. Belum pasti tersedia di paket Free — lihat Fase 0. */
async function sentPostsWithMetrics({ first = 50 } = {}) {
  const posts = [];
  const errors = [];

  for (const account of ['A', 'B']) {
    if (!TOKENS[account]) continue;
    try {
      const orgId = await organizationId(account);
      const data = await gql(account, SENT_WITH_METRICS, { organizationId: orgId, first });
      for (const edge of data?.posts?.edges || []) posts.push({ ...edge.node, account });
    } catch (err) {
      errors.push(`akun ${account}: ${err.message}`);
    }
  }
  return { posts, errors };
}

module.exports = {
  BufferError,
  hasToken: (account) => !!TOKENS[account],
  anyToken: () => !!(TOKENS.A || TOKENS.B),
  usageSnapshot,
  organizationId,
  discoverChannels,
  scheduledCounts,
  bumpScheduled,
  channelBoards,
  createPost,
  sentPostsWithMetrics
};
