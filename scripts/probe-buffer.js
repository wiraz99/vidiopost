#!/usr/bin/env node
/**
 * FASE 0 — Probe Buffer API.
 *
 * Menjawab pertanyaan yang tidak bisa dijawab dari dokumentasi:
 *   1. Apakah akun Free benar-benar mengembalikan angka metrics?
 *   2. Apa saja nilai enum ShareMode (ada `shareNow` yang tak terdokumentasi?)
 *   3. Apakah CreatePostInput punya field khusus judul / link?
 *   4. Apakah tipe Channel punya jumlah follower?
 *   5. Berapa post yang sekarang mengantre per channel?
 *
 * Jalankan:  node scripts/probe-buffer.js
 * Butuh .env berisi BUFFER_TOKEN_A dan/atau BUFFER_TOKEN_B.
 *
 * Hemat kuota: 6 request per token (limit paket Free 250/hari).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const ENDPOINT = 'https://api.buffer.com/graphql';
const OUT_FILE = path.join(__dirname, '..', 'probe-result.json');

let requestCount = 0;

async function gql(token, query, variables) {
  requestCount++;
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { httpStatus: r.status, parseError: true, raw: text.slice(0, 500) };
  }
  return { httpStatus: r.status, ...body };
}

// --- 1. Introspeksi tipe: enum + field yang kita butuhkan, dalam SATU request ---
const INTROSPECT = `
query Introspect {
  shareMode:      __type(name: "ShareMode")       { enumValues { name } }
  schedulingType: __type(name: "SchedulingType")  { enumValues { name } }
  postStatus:     __type(name: "PostStatus")      { enumValues { name } }
  postMetricType: __type(name: "PostMetricType")  { enumValues { name } }
  postTypeEnum:   __type(name: "PostType")        { enumValues { name } }
  createPostInput: __type(name: "CreatePostInput") {
    inputFields { name type { name kind ofType { name kind } } }
  }
  channelType: __type(name: "Channel") {
    fields { name type { name kind ofType { name kind } } }
  }
  postType: __type(name: "Post") {
    fields { name type { name kind ofType { name kind } } }
  }
}`;

const ACCOUNT = `
query Account {
  account {
    id
    organizations { id name }
  }
}`;

const CHANNELS = `
query Channels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id
    service
    name
    type
  }
}`;

const SCHEDULED = `
query Scheduled($organizationId: OrganizationId!) {
  posts(first: 50, input: {
    organizationId: $organizationId
    filter: { status: [scheduled] }
  }) {
    edges { node { id channelId dueAt status } }
    pageInfo { hasNextPage }
  }
}`;

const SENT_WITH_METRICS = `
query SentWithMetrics($organizationId: OrganizationId!) {
  posts(first: 10, input: {
    organizationId: $organizationId
    filter: { status: [sent] }
  }) {
    edges {
      node {
        id
        channelId
        dueAt
        metricsUpdatedAt
        metrics { type name value unit }
      }
    }
  }
}`;

const PINTEREST_BOARDS = `
query PinterestBoards($id: ChannelId!) {
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

const DAILY_LIMITS = `
query DailyLimits($organizationId: OrganizationId!) {
  dailyPostingLimits(input: { organizationId: $organizationId }) {
    channelId
    limit
    used
  }
}`;

function head(title) {
  console.log(`\n${'='.repeat(64)}\n${title}\n${'='.repeat(64)}`);
}

function fail(res) {
  if (res.parseError) return `respons bukan JSON (HTTP ${res.httpStatus}): ${res.raw}`;
  if (res.errors) return res.errors.map(e => e.message).join(' | ');
  if (res.httpStatus >= 400) return `HTTP ${res.httpStatus}`;
  return null;
}

async function probeToken(label, token) {
  const report = { label, ok: false };
  head(`TOKEN ${label}`);

  // --- introspeksi ---
  const intro = await gql(token, INTROSPECT);
  const introErr = fail(intro);
  if (introErr) {
    console.log(`❌ Introspeksi gagal: ${introErr}`);
    console.log('   (kalau 401/403, token salah atau belum dibuat di Settings → API)');
    report.introspectionError = introErr;
    return report;
  }
  report.ok = true;
  const d = intro.data;

  const enumNames = (t) => (d[t]?.enumValues || []).map(v => v.name);
  report.shareMode = enumNames('shareMode');
  report.schedulingType = enumNames('schedulingType');
  report.postStatus = enumNames('postStatus');
  report.postMetricType = enumNames('postMetricType');
  report.postType = enumNames('postTypeEnum');

  console.log(`ShareMode      : ${report.shareMode.join(', ') || '(kosong)'}`);
  console.log(`SchedulingType : ${report.schedulingType.join(', ') || '(kosong)'}`);
  console.log(`PostStatus     : ${report.postStatus.join(', ') || '(kosong)'}`);
  console.log(`PostMetricType : ${report.postMetricType.join(', ') || '(kosong)'}`);
  console.log(`PostType       : ${report.postType.join(', ') || '(kosong)'}  <- nilai untuk metadata.instagram.type`);

  const shareNow = report.shareMode.find(v => /now|immediate|direct/i.test(v));
  console.log(shareNow
    ? `\n✅ PUBLISH LANGSUNG: ada mode "${shareNow}" — pakai ini, tak perlu akal-akalan dueAt+2menit`
    : `\n⚠️  PUBLISH LANGSUNG: tidak ada mode "sekarang" — pakai customScheduled dueAt = now + 2 menit`);

  const inputFields = (d.createPostInput?.inputFields || []).map(f => f.name);
  report.createPostInputFields = inputFields;
  const titleish = inputFields.filter(n => /title|link|url|destination|subject|board/i.test(n));
  console.log(`\nCreatePostInput punya ${inputFields.length} field.`);
  console.log(titleish.length
    ? `✅ FIELD JUDUL/LINK KHUSUS: ${titleish.join(', ')} — pakai ini, jangan gabung ke caption`
    : `⚠️  Tidak ada field judul/link khusus — judul YouTube & link Pinterest tetap digabung ke teks`);

  const channelFields = (d.channelType?.fields || []).map(f => f.name);
  report.channelFields = channelFields;
  const followerish = channelFields.filter(n => /follow|subscriber|audience|fan|member/i.test(n));
  console.log(`\nField tipe Channel: ${channelFields.join(', ')}`);
  console.log(followerish.length
    ? `✅ FOLLOWER: ada field ${followerish.join(', ')} — grafik perkembangan akun BISA dibuat`
    : `⚠️  FOLLOWER: tidak ada di API — insight dibatasi ke metrik konten saja`);

  const postFields = (d.postType?.fields || []).map(f => f.name);
  report.postFields = postFields;
  const urlish = postFields.filter(n => /url|permalink|link/i.test(n));
  console.log(`\nLink post tayang: ${urlish.length ? '✅ ' + urlish.join(', ') : '⚠️  tidak tersedia'}`);

  // --- organizationId ---
  const acct = await gql(token, ACCOUNT);
  const acctErr = fail(acct);
  if (acctErr) {
    console.log(`\n❌ Query account gagal: ${acctErr}`);
    report.accountError = acctErr;
    return report;
  }
  const orgs = acct.data?.account?.organizations || [];
  report.organizations = orgs;
  console.log(`\nOrganisasi: ${orgs.map(o => `${o.name} (${o.id})`).join(', ') || '(kosong)'}`);
  if (!orgs.length) return report;

  const organizationId = orgs[0].id;
  report.organizationId = organizationId;

  // --- channels ---
  const chRes = await gql(token, CHANNELS, { organizationId });
  const chErr = fail(chRes);
  if (chErr) {
    console.log(`❌ Query channels gagal: ${chErr}`);
    report.channelsError = chErr;
  } else {
    report.channels = chRes.data?.channels || [];
    console.log(`\n✅ CHANNEL (${report.channels.length}) — salin id ini kalau mau isi channels.json manual:`);
    for (const c of report.channels) {
      console.log(`   ${(c.service || '?').padEnd(11)} ${(c.name || '').padEnd(24)} ${c.id}`);
    }
  }

  // --- board Pinterest (dibutuhkan metadata.pinterest.boardServiceId) ---
  const pin = (report.channels || []).find((c) => /pinterest/i.test(c.service || ''));
  if (pin) {
    const boardRes = await gql(token, PINTEREST_BOARDS, { id: pin.id });
    const boardErr = fail(boardRes);
    if (boardErr) {
      console.log(`\n(board Pinterest belum bisa dibaca: ${boardErr})`);
      console.log('   -> kirim pesan ini ke Claude, nama field-nya perlu disesuaikan');
      report.pinterestBoardsError = boardErr;
    } else {
      report.pinterestBoards = boardRes.data?.channel?.metadata?.boards || [];
      console.log('\n✅ BOARD PINTEREST (normalnya cukup dipilih di halaman Pengaturan):');
      for (const b of report.pinterestBoards) {
        console.log(`   ${String(b.name || '').padEnd(28)} ${b.serviceId}`);
      }
      if (!report.pinterestBoards.length) console.log('   (belum ada board di akun ini)');
    }
  }

  // --- antrian ---
  const schedRes = await gql(token, SCHEDULED, { organizationId });
  const schedErr = fail(schedRes);
  if (schedErr) {
    console.log(`\n❌ Query antrian gagal: ${schedErr}`);
    report.scheduledError = schedErr;
  } else {
    const nodes = (schedRes.data?.posts?.edges || []).map(e => e.node);
    report.scheduledCount = nodes.length;
    const byChannel = {};
    for (const n of nodes) byChannel[n.channelId] = (byChannel[n.channelId] || 0) + 1;
    report.scheduledByChannel = byChannel;
    console.log(`\n✅ ANTRIAN ASLI: ${nodes.length} post terjadwal`);
    for (const [id, n] of Object.entries(byChannel)) console.log(`   ${id}: ${n}/10`);
    if (!nodes.length) console.log('   (belum ada yang mengantre)');
  }

  // --- METRICS: pertanyaan paling penting ---
  const mRes = await gql(token, SENT_WITH_METRICS, { organizationId });
  const mErr = fail(mRes);
  if (mErr) {
    console.log(`\n❌ METRICS TIDAK BISA DIAKSES: ${mErr}`);
    console.log('   → Fase 5 (Insight) tidak bisa pakai Buffer. Perlu rencana pengganti.');
    report.metricsError = mErr;
  } else {
    const nodes = (mRes.data?.posts?.edges || []).map(e => e.node);
    const withValues = nodes.filter(n => (n.metrics || []).some(m => m.value != null));
    report.sentCount = nodes.length;
    report.postsWithMetrics = withValues.length;
    report.sampleMetrics = nodes[0]?.metrics || [];
    console.log(`\n${'*'.repeat(64)}`);
    if (!nodes.length) {
      console.log('⚠️  METRICS: belum ada post berstatus "sent", jadi belum bisa disimpulkan.');
      console.log('   → Jalankan lagi setelah ada post yang benar-benar tayang.');
    } else if (withValues.length) {
      console.log(`✅ METRICS TERSEDIA DI PAKET INI — ${withValues.length}/${nodes.length} post punya angka.`);
      console.log('   → Fase 5 (Insight) JALAN sesuai plan.');
      console.log('   Contoh:');
      for (const m of report.sampleMetrics.slice(0, 8)) {
        console.log(`     ${String(m.name).padEnd(20)} ${m.value} ${m.unit || ''}`);
      }
    } else {
      console.log(`⚠️  METRICS KOSONG — ada ${nodes.length} post terkirim tapi belum ada angkanya.`);
      console.log('   → Ini BUKAN soal paket: API Buffer tersedia di semua paket termasuk Free.');
      console.log('   → Buffer menarik metrik dari tiap jaringan sekali sehari, dan post baru');
      console.log('     butuh sampai ~24 jam. Cek lagi besok.');
      console.log('   → Halaman Insight di aplikasi sudah menampilkan rincian per channel,');
      console.log('     jadi biasanya tidak perlu menjalankan script ini.');
    }
    console.log('*'.repeat(64));
  }

  // --- batas posting harian ---
  const limRes = await gql(token, DAILY_LIMITS, { organizationId });
  const limErr = fail(limRes);
  if (limErr) {
    console.log(`\n(dailyPostingLimits tidak tersedia: ${limErr})`);
    report.dailyLimitsError = limErr;
  } else {
    report.dailyPostingLimits = limRes.data?.dailyPostingLimits || [];
    console.log(`\nBatas posting harian: ${JSON.stringify(report.dailyPostingLimits)}`);
  }

  return report;
}

(async () => {
  const tokens = [
    ['A (TikTok/YouTube/Instagram)', process.env.BUFFER_TOKEN_A],
    ['B (Facebook/Threads/Pinterest)', process.env.BUFFER_TOKEN_B]
  ].filter(([, t]) => t);

  if (!tokens.length) {
    console.error('❌ BUFFER_TOKEN_A / BUFFER_TOKEN_B belum diisi di .env');
    console.error('   Ambil token di Buffer: Settings → API → create API key');
    process.exit(1);
  }

  const reports = [];
  for (const [label, token] of tokens) {
    try {
      reports.push(await probeToken(label, token));
    } catch (err) {
      console.log(`\n❌ Token ${label} error: ${err.message}`);
      reports.push({ label, fatal: err.message });
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ probedAt: new Date().toISOString(), requestCount, reports }, null, 2));

  head('RINGKASAN');
  console.log(`Total request terpakai: ${requestCount} (batas paket Free: 250/hari)`);
  console.log(`Hasil lengkap disimpan di: ${OUT_FILE}`);
  console.log('\nKirim isi file itu ke Claude untuk menentukan Fase 5.');
})();
