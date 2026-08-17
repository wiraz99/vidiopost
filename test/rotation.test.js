const test = require('node:test');
const assert = require('node:assert');
const { buildRotation, zonedToUtc, addDays, DEFAULT_HOURS } = require('../lib/rotation');

const videos = (n) => Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, title: `Video ${i + 1}` }));
const channels = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, label: `Channel ${i + 1}`, platform: 'tiktok', account: 'A' }));

// ---------- inti rotasi ----------

test('tiap hari, semua channel menayangkan video yang berbeda', () => {
  const { matrix, totalDays } = buildRotation({
    videos: videos(6), channels: channels(6), startDate: '2026-08-20'
  });

  for (let day = 0; day < totalDays; day++) {
    const perHari = matrix.map((row) => row.cells[day].videoId);
    assert.strictEqual(new Set(perHari).size, perHari.length,
      `hari ke-${day} ada video kembar: ${perHari.join(', ')}`);
  }
});

test('tiap channel kebagian semua video, masing-masing di hari berbeda', () => {
  const { matrix } = buildRotation({
    videos: videos(6), channels: channels(6), startDate: '2026-08-20'
  });

  for (const row of matrix) {
    const ids = row.cells.map((c) => c.videoId);
    assert.strictEqual(new Set(ids).size, 6, `${row.label} tidak dapat 6 video unik`);
    const tanggal = row.cells.map((c) => c.date);
    assert.strictEqual(new Set(tanggal).size, 6, `${row.label} punya dua video di tanggal sama`);
  }
});

test('matriks cocok dengan contoh di plan (rotasi geser 1)', () => {
  const { matrix } = buildRotation({
    videos: videos(6), channels: channels(6), startDate: '2026-08-20'
  });
  // baris 0 mulai V1, baris 1 mulai V2, dst
  assert.deepStrictEqual(matrix.map((r) => r.cells[0].videoId), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  // channel ke-2 di hari terakhir balik ke V1
  assert.strictEqual(matrix[1].cells[5].videoId, 'v1');
});

test('stok 10 video x 6 channel: 60 item, tiap channel 10 hari', () => {
  const { items, matrix, totalDays } = buildRotation({
    videos: videos(10), channels: channels(6), startDate: '2026-08-20'
  });
  assert.strictEqual(totalDays, 10);
  assert.strictEqual(items.length, 60);
  for (const row of matrix) assert.strictEqual(new Set(row.cells.map((c) => c.videoId)).size, 10);
});

// ---------- peringatan ----------

test('channel lebih banyak dari video memunculkan peringatan', () => {
  const { warnings } = buildRotation({
    videos: videos(3), channels: channels(6), startDate: '2026-08-20'
  });
  assert.ok(warnings.some((w) => w.includes('video yang sama')), warnings.join('\n'));
});

test('melebihi batas antrian Buffer memunculkan peringatan', () => {
  const { warnings } = buildRotation({
    videos: videos(12), channels: channels(2), startDate: '2026-08-20'
  });
  assert.ok(warnings.some((w) => w.includes('batas antrian')), warnings.join('\n'));
});

test('post yang sudah mengantre ikut dihitung ke batas', () => {
  const { warnings } = buildRotation({
    videos: videos(6), channels: channels(1), startDate: '2026-08-20',
    existingScheduled: { c1: 7 }
  });
  assert.ok(warnings.some((w) => w.includes('7 post sudah mengantre')), warnings.join('\n'));
});

test('input kosong ditangani tanpa melempar error', () => {
  assert.deepStrictEqual(buildRotation({}).items, []);
  assert.ok(buildRotation({ videos: videos(2), channels: channels(1) }).warnings.length);
});

// ---------- zona waktu: bagian paling rawan ----------

test('19:00 WIB = 12:00 UTC hari yang sama', () => {
  assert.strictEqual(
    zonedToUtc('2026-08-20', '19:00', 'Asia/Jakarta').toISOString(),
    '2026-08-20T12:00:00.000Z'
  );
});

test('jam dini hari WIB mundur ke tanggal sebelumnya dalam UTC', () => {
  // 06:00 WIB = 23:00 UTC hari sebelumnya
  assert.strictEqual(
    zonedToUtc('2026-08-20', '06:00', 'Asia/Jakarta').toISOString(),
    '2026-08-19T23:00:00.000Z'
  );
});

test('tengah malam WIB tidak meleset sehari', () => {
  assert.strictEqual(
    zonedToUtc('2026-08-20', '00:00', 'Asia/Jakarta').toISOString(),
    '2026-08-19T17:00:00.000Z'
  );
});

test('zona ber-DST dikonversi benar di kedua sisi peralihan', () => {
  // New York: Maret masih EST (-5), Juli sudah EDT (-4)
  assert.strictEqual(
    zonedToUtc('2026-03-01', '12:00', 'America/New_York').toISOString(),
    '2026-03-01T17:00:00.000Z'
  );
  assert.strictEqual(
    zonedToUtc('2026-07-01', '12:00', 'America/New_York').toISOString(),
    '2026-07-01T16:00:00.000Z'
  );
});

test('dueAt yang dihasilkan rotasi konsisten dengan dueAtLocal', () => {
  const { items } = buildRotation({
    videos: videos(2), channels: channels(1), startDate: '2026-08-20',
    timezone: 'Asia/Jakarta', channelHours: { c1: '19:00' }
  });
  assert.strictEqual(items[0].dueAtLocal, '2026-08-20T19:00');
  assert.strictEqual(items[0].dueAt, '2026-08-20T12:00:00.000Z');
});

// ---------- tanggal & jam ----------

test('addDays melewati pergantian bulan dan tahun kabisat', () => {
  assert.strictEqual(addDays('2026-08-30', 3), '2026-09-02');
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29'); // 2028 kabisat
});

test('daysBetween memberi jarak antar putaran', () => {
  const { matrix } = buildRotation({
    videos: videos(3), channels: channels(1), startDate: '2026-08-20', daysBetween: 3
  });
  assert.deepStrictEqual(matrix[0].cells.map((c) => c.date), ['2026-08-20', '2026-08-23', '2026-08-26']);
});

test('jam bawaan digilir supaya tidak semua channel jatuh di jam sama', () => {
  const { matrix } = buildRotation({
    videos: videos(2), channels: channels(3), startDate: '2026-08-20'
  });
  assert.deepStrictEqual(matrix.map((r) => r.cells[0].time), DEFAULT_HOURS.slice(0, 3));
});

test('jam khusus per channel mengalahkan jam bawaan', () => {
  const { items } = buildRotation({
    videos: videos(1), channels: channels(2), startDate: '2026-08-20',
    channelHours: { c2: '06:30' }
  });
  assert.strictEqual(items.find((i) => i.channelId === 'c2').time, '06:30');
});

// ---------- jadwal yang sudah lewat ----------

test('jadwal di waktu yang sudah lewat diperingatkan dan ditandai', () => {
  // Anggap "sekarang" jauh setelah tanggal jadwalnya.
  const { items, warnings } = buildRotation({
    videos: videos(2), channels: channels(1), startDate: '2026-08-17',
    timezone: 'Asia/Jakarta', channelHours: { c1: '09:00' },
    now: new Date('2026-08-17T12:00:00+07:00').getTime()
  });

  assert.ok(warnings.some((w) => w.includes('SUDAH LEWAT')), warnings.join('\n'));
  assert.strictEqual(items[0].isPast, true, 'item 09:00 hari ini seharusnya ditandai lewat');
  assert.ok(!items[1].isPast, 'item besok seharusnya tidak ditandai lewat');
});

test('jadwal yang seluruhnya di masa depan tidak diperingatkan', () => {
  const { warnings, items } = buildRotation({
    videos: videos(3), channels: channels(2), startDate: '2026-08-20',
    now: new Date('2026-08-17T12:00:00+07:00').getTime()
  });
  assert.ok(!warnings.some((w) => w.includes('SUDAH LEWAT')), warnings.join('\n'));
  assert.ok(items.every((i) => !i.isPast));
});
