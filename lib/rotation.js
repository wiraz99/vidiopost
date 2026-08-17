/**
 * Algoritma rotasi jadwal — fungsi murni, tanpa I/O, supaya bisa dites terpisah.
 *
 * Aturannya satu baris:
 *
 *     videoIndex = (dayIndex + channelIndex * offsetStep) % jumlahVideo
 *
 * Efeknya dua-duanya sekaligus:
 *   - dibaca per KOLOM (satu hari): tiap channel menayangkan video yang berbeda
 *   - dibaca per BARIS (satu channel): tiap video kebagian hari yang berlainan
 *
 *           Sen  Sel  Rab  Kam  Jum  Sab
 * TikTok     V1   V2   V3   V4   V5   V6
 * Instagram  V2   V3   V4   V5   V6   V1
 * YouTube    V3   V4   V5   V6   V1   V2
 * ...
 */

const QUEUE_LIMIT = 10; // batas antrian Buffer per channel

// Jam tayang bawaan, digilir per channel supaya tidak semua post jatuh di jam yang sama.
const DEFAULT_HOURS = ['09:00', '12:00', '15:00', '17:00', '19:00', '21:00'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Selisih zona waktu (ms) pada suatu instant tertentu.
 * Dipakai supaya tidak perlu library tanggal.
 */
function tzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  // Sebagian locale menulis tengah malam sebagai "24", jadi dinormalkan.
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - instant.getTime();
}

/**
 * Ubah waktu dinding lokal (mis. 19:00 WIB) jadi instant UTC.
 * Buffer mewajibkan dueAt dalam ISO 8601 UTC, dan ini sumber bug paling umum.
 */
function zonedToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);

  // Dua langkah: tebak offset, lalu koreksi kalau hasilnya melintasi pergantian offset (DST).
  let utc = naive - tzOffsetMs(new Date(naive), timeZone);
  utc = naive - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Tambah hari pada tanggal kalender 'YYYY-MM-DD'. Murni aritmetika kalender. */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Susun jadwal rotasi.
 *
 * @param {object[]} videos            urutan video, [{ id, title }]
 * @param {object[]} channels          urutan channel, [{ id, label, platform, account }]
 * @param {string}   startDate         'YYYY-MM-DD' (tanggal lokal)
 * @param {string}   timezone          mis. 'Asia/Jakarta'
 * @param {number}   daysBetween       jarak hari antar putaran (default 1)
 * @param {number}   offsetStep        pergeseran video antar channel (default 1)
 * @param {object}   channelHours      { [channelId]: 'HH:mm' }
 * @param {number}   days              berapa hari dijalankan (default = jumlah video)
 * @param {object}   existingScheduled { [channelId]: jumlah post yang sudah mengantre }
 */
function buildRotation({
  videos = [],
  channels = [],
  startDate,
  timezone = 'Asia/Jakarta',
  daysBetween = 1,
  offsetStep = 1,
  channelHours = {},
  days = null,
  existingScheduled = {},
  now = Date.now()
} = {}) {
  const warnings = [];

  if (!videos.length) return { items: [], matrix: [], warnings: ['Belum ada video yang dipilih.'] };
  if (!channels.length) return { items: [], matrix: [], warnings: ['Belum ada channel yang dipilih.'] };
  if (!startDate) return { items: [], matrix: [], warnings: ['Tanggal mulai belum diisi.'] };

  const N = videos.length;
  const totalDays = days && days > 0 ? days : N;

  if (channels.length > N) {
    warnings.push(
      `Ada ${channels.length} channel tapi cuma ${N} video, jadi di hari yang sama akan ada ` +
      'channel yang menayangkan video yang sama. Tambah video supaya tiap channel dapat video berbeda.'
    );
  }

  const items = [];
  const matrix = []; // baris = channel, kolom = hari

  channels.forEach((channel, channelIndex) => {
    const time = channelHours[channel.id] || DEFAULT_HOURS[channelIndex % DEFAULT_HOURS.length];
    const row = { channelId: channel.id, label: channel.label, platform: channel.platform, cells: [] };

    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
      const videoIndex = (dayIndex + channelIndex * offsetStep) % N;
      const video = videos[videoIndex];
      const date = addDays(startDate, dayIndex * daysBetween);
      const dueAtLocal = `${date}T${time}`;

      items.push({
        videoId: video.id,
        videoTitle: video.title || video.filename || video.id,
        channelId: channel.id,
        channelLabel: channel.label,
        platform: channel.platform,
        account: channel.account,
        dayIndex,
        date,
        time,
        dueAtLocal,
        dueAt: zonedToUtc(date, time, timezone).toISOString(),
        status: 'draft'
      });

      row.cells.push({ date, time, videoId: video.id, videoTitle: video.title || video.filename });
    }
    matrix.push(row);
  });

  // Buffer menolak jadwal yang waktunya sudah lewat ("Scheduled time must be
  // in the future"). Jam tayang bawaan pagi/siang gampang terlewat kalau
  // jadwalnya dibuat sore hari.
  const past = items.filter((i) => new Date(i.dueAt).getTime() <= now);
  if (past.length) {
    const contoh = past.slice(0, 3).map((i) => `${i.channelLabel} ${i.date} ${i.time}`).join('; ');
    warnings.push(
      `${past.length} post terjadwal di waktu yang SUDAH LEWAT (${contoh}${past.length > 3 ? '; …' : ''}). ` +
      'Buffer akan menolaknya. Mundurkan tanggal mulai, atau ubah jam tayang channel yang bersangkutan.'
    );
    for (const item of past) item.isPast = true;
  }

  // Cek batas antrian Buffer per channel, termasuk yang sudah mengantre di sana.
  for (const channel of channels) {
    const incoming = totalDays;
    const already = existingScheduled[channel.id] || 0;
    if (already + incoming > QUEUE_LIMIT) {
      warnings.push(
        `${channel.label}: ${already} post sudah mengantre + ${incoming} baru = ${already + incoming}, ` +
        `melebihi batas antrian Buffer (${QUEUE_LIMIT}). Buffer kemungkinan menolak sisanya.`
      );
    }
  }

  return { items, matrix, warnings, totalDays, videoCount: N, channelCount: channels.length };
}

module.exports = { buildRotation, zonedToUtc, tzOffsetMs, addDays, QUEUE_LIMIT, DEFAULT_HOURS };
