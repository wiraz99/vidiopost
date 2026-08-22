/**
 * Akun Buffer yang jumlahnya bebas, dan kuota yang dihitung per token.
 *
 * Dua hal yang diuji di sini punya akibat nyata:
 *  - kalau token tidak terbaca dinamis, brand baru tidak bisa punya channel
 *    sama sekali (paket gratis Buffer cuma 3 channel per akun)
 *  - kalau kuota dihitung gabungan, aplikasi menolak bekerja di angka 250
 *    padahal masih ada ratusan request tersisa di token-token lain
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// Harus disetel SEBELUM lib/store & lib/buffer diimpor — keduanya membaca
// environment saat dimuat.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vpa-akun-'));
process.env.DATA_DIR = DIR;
process.env.MEDIA_DIR = DIR;

// Diarahkan ke alamat mati SEBELUM lib/buffer dimuat. Tanpa ini, tes yang
// menembus penjaga kuota akan benar-benar memanggil API Buffer sungguhan dan
// membakar kuota harian yang asli.
process.env.BUFFER_ENDPOINT = 'http://127.0.0.1:59999/graphql';

process.env.BUFFER_TOKEN_A = 'token-a';
process.env.BUFFER_TOKEN_B = 'token-b';
process.env.BUFFER_TOKEN_C = 'token-c';
// Variabel yang ada tapi kosong TIDAK boleh dihitung sebagai akun: kalau ikut
// terhitung, tiap pembacaan channel akan gagal dengan "token belum diisi".
process.env.BUFFER_TOKEN_D = '   ';

const store = require('../lib/store');
const buffer = require('../lib/buffer');

const bersihkan = () => {
  try {
    fs.unlinkSync(path.join(DIR, 'buffer-usage.json'));
  } catch {
    // memang belum ada
  }
};

const pakai = (akun, n) => store.write('buffer-usage', {
  ...store.read('buffer-usage', {}),
  [akun]: { day: new Date().toISOString().slice(0, 10), dayCount: n, recent: [] }
});

test('akun dipungut dari environment, yang kosong diabaikan', () => {
  assert.deepStrictEqual(buffer.daftarAkun(), ['A', 'B', 'C']);
  assert.strictEqual(buffer.anyToken(), true);
  assert.strictEqual(buffer.hasToken('C'), true);
  assert.strictEqual(buffer.hasToken('D'), false);
});

test('kuota tiap akun berdiri sendiri', () => {
  bersihkan();
  pakai('A', 200);
  pakai('C', 5);

  const snap = buffer.usageSnapshot();
  const per = Object.fromEntries(snap.perAkun.map((a) => [a.akun, a.dayCount]));

  assert.strictEqual(per.A, 200);
  assert.strictEqual(per.B, 0);
  assert.strictEqual(per.C, 5);
  assert.strictEqual(snap.totalHariIni, 205);
});

test('akunTerpadat menunjuk yang paling dekat batas, bukan yang pertama', () => {
  bersihkan();
  pakai('A', 12);
  pakai('C', 233);

  const snap = buffer.usageSnapshot();
  assert.strictEqual(snap.akunTerpadat, 'C');
  // Angka di tingkat atas dipakai batang kuota di sidebar — harus milik akun
  // terpadat, karena akun itulah yang duluan menolak pengiriman.
  assert.strictEqual(snap.dayCount, 233);
});

test('bentuk penghitung LAMA dipindahkan ke semua akun, tidak hilang', () => {
  bersihkan();
  // Bentuk sebelum perubahan ini: satu penghitung tunggal untuk semua akun.
  store.write('buffer-usage', {
    day: new Date().toISOString().slice(0, 10),
    dayCount: 180,
    recent: []
  });

  const per = Object.fromEntries(buffer.usageSnapshot().perAkun.map((a) => [a.akun, a.dayCount]));
  // Melebihkan aman; mengurangi berisiko kena 429 sungguhan dari Buffer.
  assert.strictEqual(per.A, 180);
  assert.strictEqual(per.B, 180);
  assert.strictEqual(per.C, 180);
});

test('catatan dari hari sebelumnya direset', () => {
  bersihkan();
  store.write('buffer-usage', {
    A: { day: '2020-01-01', dayCount: 240, recent: [] }
  });
  const per = Object.fromEntries(buffer.usageSnapshot().perAkun.map((a) => [a.akun, a.dayCount]));
  assert.strictEqual(per.A, 0);
});

/**
 * Cache channel bertahan 1 jam DAN tersimpan di volume permanen, jadi deploy
 * ulang tidak membersihkannya. Tanpa pemeriksaan ini, menambahkan
 * BUFFER_TOKEN_C lalu redeploy tidak menghasilkan apa-apa sampai satu jam
 * berlalu — dan tidak ada satu pun petunjuk di layar kenapa.
 */
const seedCache = (akun) => store.write('channels-cache', {
  fetchedAt: new Date().toISOString(),
  akun,
  channels: akun.flatMap((a) => [{ id: `ch_${a}`, platform: 'tiktok', label: `TT ${a}`, account: a }])
});

test('cache dipakai selama daftar akunnya masih sama', async () => {
  bersihkan();
  seedCache(['A', 'B', 'C']);

  const hasil = await buffer.discoverChannels();
  assert.strictEqual(hasil.source, 'cache');
  assert.strictEqual(hasil.channels.length, 3);
});

test('token BARU membuat cache dilewati, tanpa menunggu TTL', async () => {
  bersihkan();
  // Cache dibuat waktu baru ada akun A dan B; sekarang environment punya C.
  seedCache(['A', 'B']);

  // Endpoint diarahkan ke alamat mati, jadi kalau cache benar-benar DILEWATI
  // fungsinya akan gagal mengambil dari API — dan itulah buktinya. Kalau cache
  // masih dipakai, dia akan mengembalikan jawaban dengan tenang.
  await assert.rejects(
    () => buffer.discoverChannels(),
    (err) => {
      assert.strictEqual(err.code, 'NO_CHANNELS');
      return true;
    },
    'cache seharusnya dilewati begitu ada akun baru di environment'
  );
});

test('cache lama tanpa catatan akun tetap dikenali dari channelnya', async () => {
  bersihkan();
  // Bentuk cache sebelum perubahan ini: tidak punya field `akun` sama sekali.
  store.write('channels-cache', {
    fetchedAt: new Date().toISOString(),
    channels: [
      { id: 'ch_a', platform: 'tiktok', label: 'TT A', account: 'A' },
      { id: 'ch_b', platform: 'tiktok', label: 'TT B', account: 'B' },
      { id: 'ch_c', platform: 'tiktok', label: 'TT C', account: 'C' }
    ]
  });

  // Ketiga akun sudah terwakili, jadi tidak ada yang baru — cache tetap dipakai.
  const hasil = await buffer.discoverChannels();
  assert.strictEqual(hasil.source, 'cache');
});

test('akun yang kuotanya habis tidak memblokir akun lain', async () => {
  bersihkan();
  pakai('A', 245);   // di atas 250 - margin 10

  // Endpoint sengaja diarahkan ke alamat yang pasti gagal: yang diuji di sini
  // adalah PENJAGA KUOTA sebelum request, bukan hasil requestnya.
  await assert.rejects(
    () => buffer.organizationId('A'),
    (err) => {
      assert.strictEqual(err.code, 'RATE_BUDGET_DAY');
      assert.match(err.message, /akun A/);
      return true;
    },
    'akun A seharusnya ditolak karena kuotanya sendiri hampir habis'
  );

  // Akun C masih lega, jadi TIDAK boleh ikut ditolak oleh penjaga kuota.
  // Dia akan gagal, tapi karena jaringan — bukan karena RATE_BUDGET_DAY.
  await assert.rejects(
    () => buffer.organizationId('C'),
    (err) => {
      assert.notStrictEqual(err.code, 'RATE_BUDGET_DAY');
      return true;
    },
    'akun C tidak boleh ikut terblokir gara-gara akun A'
  );
});
