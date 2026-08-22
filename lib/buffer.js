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

/**
 * Akun Buffer dipungut dari environment, tidak ditulis satu per satu.
 *
 * Dulu cuma ada A dan B, dan itu jadi tembok begitu ada brand kedua: paket
 * gratis Buffer memberi 3 channel per akun, jadi brand baru selalu butuh akun
 * Buffer baru. Sekarang `BUFFER_TOKEN_C` cukup ditambahkan di Coolify lalu
 * deploy ulang — tanpa menyentuh kode ini lagi.
 *
 * Nama akun = apa pun sesudah `BUFFER_TOKEN_`. Nilai kosong diabaikan, supaya
 * variabel yang sudah dibuat tapi belum diisi tidak terhitung sebagai akun dan
 * bikin semua pembacaan channel gagal.
 */
function bacaTokens() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    const cocok = /^BUFFER_TOKEN_([A-Z0-9_]+)$/.exec(key);
    if (cocok && String(value || '').trim()) out[cocok[1]] = String(value).trim();
  }
  return out;
}

const TOKENS = bacaTokens();

/** Nama akun yang tokennya benar-benar terisi, urut supaya tampilannya stabil. */
const daftarAkun = () => Object.keys(TOKENS).sort();

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

const kosong = () => ({ day: '', dayCount: 0, recent: [] });

/**
 * Pemakaian dihitung PER TOKEN, karena begitulah Buffer menghitungnya.
 *
 * Dulu satu penghitung untuk semua akun. Dengan dua akun itu cuma terlalu
 * hati-hati, tapi begitu akunnya empat, aplikasi akan menolak bekerja di angka
 * 250 padahal masih ada 750 request tersisa di token-token lain.
 */
function loadUsage() {
  const simpanan = store.read('buffer-usage', null);
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = Date.now() - 15 * 60 * 1000;
  const akun = daftarAkun();

  // Bentuk LAMA (satu penghitung tunggal) dipindahkan ke SEMUA akun, bukan
  // dibagi rata dan bukan dibuang. Melebihkan hitungan paling banter menunda
  // beberapa request di hari peralihan; mengurangi hitungan berisiko kena 429
  // sungguhan dari Buffer, yang jauh lebih merepotkan.
  const lama = simpanan && typeof simpanan.dayCount === 'number' ? simpanan : null;

  const out = {};
  for (const nama of akun) {
    const e = (!lama && simpanan?.[nama]) || lama || kosong();
    out[nama] = {
      day: today,
      // Penghitung harian direset kalau catatannya dari hari lain.
      dayCount: e.day === today ? (e.dayCount || 0) : 0,
      recent: (e.recent || []).filter((t) => t > cutoff)
    };
  }
  return out;
}

const simpanUsage = (semua) => store.write('buffer-usage', semua);

function checkBudget(account, n = 1) {
  const semua = loadUsage();
  const u = semua[account] || kosong();

  if (u.dayCount + n > LIMIT_24H - SAFETY_MARGIN) {
    throw new BufferError(
      `Kuota harian Buffer akun ${account} hampir habis (${u.dayCount}/${LIMIT_24H} request hari ini). ` +
      'Tunggu sampai besok atau kurangi jumlah post.',
      { code: 'RATE_BUDGET_DAY', status: 429 }
    );
  }
  if (u.recent.length + n > LIMIT_15M - SAFETY_MARGIN) {
    throw new BufferError(
      `Terlalu banyak request ke Buffer akun ${account} dalam 15 menit terakhir ` +
      `(${u.recent.length}/${LIMIT_15M}). Tunggu beberapa menit.`,
      { code: 'RATE_BUDGET_15M', status: 429 }
    );
  }
  return u;
}

function recordUsage(account, n = 1) {
  const semua = loadUsage();
  const u = semua[account] || (semua[account] = kosong());
  u.day = new Date().toISOString().slice(0, 10);
  u.dayCount += n;
  const now = Date.now();
  for (let i = 0; i < n; i++) u.recent.push(now);
  simpanUsage(semua);
  return u;
}

function usageSnapshot() {
  const semua = loadUsage();
  const scheduled = store.read('scheduled-cache', null);
  const channels = store.read('channels-cache', null);
  const ageMin = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);

  const perAkun = daftarAkun().map((akun) => ({
    akun,
    day: semua[akun]?.day || '',
    dayCount: semua[akun]?.dayCount || 0,
    dayLimit: LIMIT_24H,
    last15m: (semua[akun]?.recent || []).length,
    limit15m: LIMIT_15M
  }));

  // Yang menghentikan pengiriman selalu SATU akun yang duluan mentok, bukan
  // gabungannya. Jadi angka di tingkat atas — yang dipakai batang kuota di
  // sidebar — adalah milik akun yang paling dekat batasnya, bukan totalnya.
  const terpadat = perAkun.reduce((a, b) => (b.dayCount > (a?.dayCount ?? -1) ? b : a), null);

  return {
    cache: {
      antrianUmurMenit: ageMin(scheduled?.fetchedAt),
      channelUmurMenit: ageMin(channels?.fetchedAt),
      antrianTtlMenit: Math.round(SCHEDULED_CACHE_TTL_MS / 60000),
      channelTtlMenit: Math.round(CHANNEL_CACHE_TTL_MS / 60000)
    },
    akunTerpadat: terpadat?.akun || null,
    perAkun,
    totalHariIni: perAkun.reduce((n, a) => n + a.dayCount, 0),
    // Nama lama dipertahankan supaya pemanggil lama tidak pecah; artinya
    // sekarang "akun yang paling terpakai".
    day: terpadat?.day || '',
    dayCount: terpadat?.dayCount || 0,
    dayLimit: LIMIT_24H,
    last15m: terpadat?.last15m || 0,
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
  checkBudget(account, 1);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables })
    });
  } finally {
    // Dihitung walau gagal — request tetap terkirim dan tetap memakan kuota.
    recordUsage(account, 1);
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

  for (const account of daftarAkun()) {
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
 * Cadangan: ambil board lewat query DAFTAR channel, bukan channel tunggal.
 *
 * `channel(input:{id})` ternyata tidak selalu bisa diandalkan — sesudah sebuah
 * channel disambungkan ulang, Buffer kadang belum melayani lookup per-id
 * padahal channelnya sudah muncul di daftar. Query daftar memakai jalur yang
 * berbeda, jadi sering berhasil saat yang pertama gagal.
 */
const CHANNELS_WITH_BOARDS = `
  query ChannelsWithBoards($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      service
      name
      metadata {
        ... on PinterestMetadata {
          boards { serviceId name }
        }
      }
    }
  }`;

const CHANNELS_WITH_BOARDS_MINIMAL = `
  query ChannelsWithBoardsMinimal($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      metadata {
        ... on PinterestMetadata {
          boards { serviceId }
        }
      }
    }
  }`;

/**
 * Tanya Buffer bentuk sebenarnya dari metadata Pinterest.
 *
 * Dipakai kalau board tetap tidak terbaca: ini menjawab apakah tipe
 * PinterestMetadata memang punya field `boards`, atau namanya sudah berubah —
 * pertanyaan yang tidak bisa dijawab dengan menebak-nebak.
 */
const SKEMA_PINTEREST = `
  query SkemaPinterest {
    pinterestMetadata: __type(name: "PinterestMetadata") { fields { name } }
    channelMetadata:   __type(name: "ChannelMetadata") { possibleTypes { name } }
    channelFields:     __type(name: "Channel") { fields { name } }
  }`;

async function introspectPinterest(account = 'A') {
  const akun = TOKENS[account] ? account : daftarAkun()[0];
  const data = await gql(akun, SKEMA_PINTEREST, {});
  return {
    diperiksaPada: new Date().toISOString(),
    akun,
    pinterestMetadata: (data?.pinterestMetadata?.fields || []).map((f) => f.name),
    tipeMetadata: (data?.channelMetadata?.possibleTypes || []).map((t) => t.name),
    channelFields: (data?.channelFields?.fields || []).map((f) => f.name)
  };
}

/** Board dari query daftar channel — jalur kedua kalau lookup per-id kosong. */
async function boardsDariDaftar(account, channelId) {
  const orgId = await organizationId(account);
  let data;
  try {
    data = await gql(account, CHANNELS_WITH_BOARDS, { organizationId: orgId });
  } catch (err) {
    if (!/cannot query field|unknown field|name/i.test(err.message)) throw err;
    data = await gql(account, CHANNELS_WITH_BOARDS_MINIMAL, { organizationId: orgId });
  }

  const cocok = (data?.channels || []).find((c) => c.id === channelId);
  return {
    channelAda: !!cocok,
    boards: (cocok?.metadata?.boards || []).map((b) => ({ id: b.serviceId, name: b.name || b.serviceId })),
    mentah: cocok ? { id: cocok.id, service: cocok.service, metadata: cocok.metadata ?? null } : null
  };
}

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
    return { boards: entry.boards, channelAda: true, jejak: [{ cara: 'cache', jumlah: entry.boards.length }] };
  }

  // Tiap percobaan dicatat apa adanya, supaya kalau tetap gagal penyebabnya
  // bisa dilihat langsung dari halaman — tanpa perlu akses terminal.
  const jejak = [];
  let boards = [];
  let channelAda = null;

  // --- Cara 1: lookup channel tunggal ---
  try {
    let data;
    try {
      data = await gql(account, BOARDS_QUERY, { id: channelId });
    } catch (err) {
      // Kalau `name` tidak ada di skema, coba lagi tanpa field itu.
      if (/name/i.test(err.message)) data = await gql(account, BOARDS_QUERY_MINIMAL, { id: channelId });
      else throw err;
    }

    // `channel: null` berarti channel-nya sendiri sudah tidak ada di Buffer —
    // biasanya karena diputus lalu disambungkan ulang, yang membuat ID-nya
    // berubah. Ini HARUS dibedakan dari "channel ada tapi belum punya board".
    channelAda = !!data?.channel;
    boards = (data?.channel?.metadata?.boards || []).map((b) => ({
      id: b.serviceId,
      name: b.name || b.serviceId
    }));

    jejak.push({
      cara: 'channel(input:{id})',
      channelAda,
      jumlah: boards.length,
      mentah: data?.channel
        ? { id: data.channel.id, metadata: data.channel.metadata ?? null }
        : null
    });
  } catch (err) {
    jejak.push({ cara: 'channel(input:{id})', error: err.message });
  }

  // --- Cara 2: lewat daftar channel, jalur yang berbeda di sisi Buffer ---
  if (!boards.length) {
    try {
      const alt = await boardsDariDaftar(account, channelId);
      jejak.push({
        cara: 'channels(input:{organizationId})',
        channelAda: alt.channelAda,
        jumlah: alt.boards.length,
        mentah: alt.mentah
      });
      if (alt.boards.length) boards = alt.boards;
      // Daftar channel lebih bisa dipercaya soal ADA/TIDAKNYA sebuah channel.
      if (channelAda === null || alt.channelAda) channelAda = alt.channelAda;
    } catch (err) {
      jejak.push({ cara: 'channels(input:{organizationId})', error: err.message });
    }
  }

  // Hanya simpan kalau benar-benar ada isinya — daftar kosong yang tersimpan
  // akan terkunci sampai masa berlakunya habis.
  if (boards.length) {
    cached[channelId] = { fetchedAt: new Date().toISOString(), boards };
    store.write(cacheKey, cached);
  }
  return { boards, channelAda, jejak };
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

  for (const account of daftarAkun()) {
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

/**
 * `channelService` diambil dari POST-nya sendiri, bukan dicocokkan lewat daftar
 * channel. Kalau channel-nya gagal terbaca (token bermasalah, channel diputus,
 * atau id berubah), pencocokan manual bikin post kehilangan platform dan post
 * itu lenyap diam-diam dari pengelompokan. Buffer sudah mengirimkannya, jadi
 * dipakai langsung.
 *
 * `externalLink` = tautan ke post aslinya di platform tujuan.
 */
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
          channelService
          text
          dueAt
          sentAt
          externalLink
          metricsUpdatedAt
          metrics { type name value unit }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;

// Cadangan tanpa field yang lebih baru. Query metrics masih ditandai
// "experimental" oleh Buffer, jadi satu field yang belum ada di skema mereka
// akan menggagalkan SELURUH query — bukan cuma field itu.
const SENT_WITH_METRICS_MINIMAL = `
  query SentWithMetricsMinimal($organizationId: OrganizationId!, $first: Int!) {
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
    }
  }`;

/**
 * Tanya langsung ke Buffer: metrik apa saja yang DIKENAL oleh API-nya?
 *
 * Ini menjawab pertanyaan yang tidak bisa dijawab oleh data post: kalau sebuah
 * platform tidak pernah mengirim angka, apakah karena API-nya memang tidak
 * punya konsep metrik itu, atau karena jaringannya yang tidak melaporkan?
 *
 * Dokumentasi Buffer menyebut metrics masih "experimental" dan TIDAK sama
 * dengan data di halaman Insights mereka, jadi daftar ini bisa berubah
 * sewaktu-waktu — karena itu ditanyakan ke servernya, bukan ditulis di kode.
 *
 * Satu request, dan hasilnya disimpan; skema tidak berubah tiap hari.
 */
const INTROSPECT_METRICS = `
  query SkemaMetrik {
    tipeMetrik: __type(name: "PostMetricType") { enumValues { name description } }
    satuan:     __type(name: "PostMetricUnit") { enumValues { name } }
    postStatus: __type(name: "PostStatus") { enumValues { name } }
    postFields: __type(name: "Post") { fields { name } }
  }`;

async function introspectMetrics(account = 'A') {
  const akun = TOKENS[account] ? account : daftarAkun()[0];
  const data = await gql(akun, INTROSPECT_METRICS, {});
  return {
    diperiksaPada: new Date().toISOString(),
    akun,
    tipeMetrik: (data?.tipeMetrik?.enumValues || []).map((v) => ({
      nama: v.name,
      keterangan: v.description || null
    })),
    satuan: (data?.satuan?.enumValues || []).map((v) => v.name),
    postStatus: (data?.postStatus?.enumValues || []).map((v) => v.name),
    postFields: (data?.postFields?.fields || []).map((f) => f.name)
  };
}

/**
 * Metrik agregat untuk sekumpulan channel dalam rentang waktu.
 *
 * Query ini PENTING untuk channel yang `Post.metrics`-nya selalu kosong
 * (TikTok, misalnya). Menurut dokumentasi Buffer, balasannya SELALU memuat
 * tiga entri dasar — postCount, reactions, comments — dan "posts on networks
 * that don't track reactions or comments contribute 0 to those totals".
 *
 * Artinya: kalau ini pun balik nol untuk sebuah channel, jaringannya memang
 * tidak melaporkan apa-apa ke Buffer — bukan aplikasi kita yang salah baca.
 */
const AGGREGATED_METRICS = `
  query AggregatedMetrics($input: AggregatedPostMetricsInput!) {
    aggregatedPostMetrics(input: $input) {
      metrics { type name value unit }
      metricsUpdatedAt
    }
  }`;

async function aggregatedMetrics({ account, channelIds, startDateTime, endDateTime }) {
  const orgId = await organizationId(account);
  const input = { organizationId: orgId, startDateTime, endDateTime };
  if (channelIds?.length) input.channelIds = channelIds;

  const data = await gql(account, AGGREGATED_METRICS, { input });
  return {
    metrics: data?.aggregatedPostMetrics?.metrics || [],
    metricsUpdatedAt: data?.aggregatedPostMetrics?.metricsUpdatedAt || null
  };
}


/**
 * Baca STATUS post apa adanya dari Buffer.
 *
 * createPost yang berhasil cuma berarti "diterima ke antrian". Buffer baru
 * mencoba menayangkannya saat waktu tiba, dan kalau jaringan tujuan menolak
 * (Pinterest paling sering), kegagalan itu tidak pernah sampai ke aplikasi ini
 * — post kita tetap tertulis "terkirim" padahal di Buffer sudah merah.
 *
 * Nilai statusnya TIDAK ditebak: daftarnya diambil dari skema Buffer lewat
 * introspectMetrics(), lalu dipakai apa adanya.
 */
async function postStatuses({ statuses, first = 100 } = {}) {
  const query = `
    query StatusPost($organizationId: OrganizationId!, $first: Int!, $status: [PostStatus!]) {
      posts(first: $first, input: {
        organizationId: $organizationId
        filter: { status: $status }
      }) {
        edges { node { id channelId status dueAt } }
      }
    }`;

  const byId = new Map();
  const errors = [];

  for (const account of daftarAkun()) {
    try {
      const orgId = await organizationId(account);
      const data = await gql(account, query, { organizationId: orgId, first, status: statuses });
      for (const edge of data?.posts?.edges || []) {
        byId.set(edge.node.id, { ...edge.node, account });
      }
    } catch (err) {
      errors.push(`akun ${account}: ${err.message}`);
    }
  }
  return { byId, errors };
}

/** Post terkirim beserta metriknya. */
async function sentPostsWithMetrics({ first = 50 } = {}) {
  const posts = [];
  const errors = [];
  let reduced = false;

  for (const account of daftarAkun()) {
    try {
      const orgId = await organizationId(account);
      let data;
      try {
        data = await gql(account, SENT_WITH_METRICS, { organizationId: orgId, first });
      } catch (err) {
        // Hanya turun ke query cadangan kalau memang soal field yang tidak dikenal.
        if (!/cannot query field|unknown field|undefined field/i.test(err.message)) throw err;
        reduced = true;
        data = await gql(account, SENT_WITH_METRICS_MINIMAL, { organizationId: orgId, first });
      }
      for (const edge of data?.posts?.edges || []) posts.push({ ...edge.node, account });
    } catch (err) {
      errors.push(`akun ${account}: ${err.message}`);
    }
  }
  return { posts, errors, reduced };
}

module.exports = {
  BufferError,
  hasToken: (account) => !!TOKENS[account],
  anyToken: () => daftarAkun().length > 0,
  daftarAkun,
  usageSnapshot,
  organizationId,
  discoverChannels,
  scheduledCounts,
  bumpScheduled,
  channelBoards,
  createPost,
  sentPostsWithMetrics,
  aggregatedMetrics,
  introspectMetrics,
  introspectPinterest,
  postStatuses
};
