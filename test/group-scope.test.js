/**
 * Aturan siapa-milik-grup-mana.
 *
 * Kesalahan di sini akibatnya berat dan tidak bisa ditarik: video brand A
 * tayang di channel brand B. Jadi tiap aturannya diuji langsung, termasuk yang
 * sengaja dibuat berbeda antara channel dan entitas lain.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  grupDari, grupChannel, milikGrup, saring, saringChannel, channelTanpaGrup, periksaCampuran
} = require('../lib/group-scope');

const BAWAAN = 'grp_utama';
const ch = (id, label) => ({ id, label });

// ---------------- entitas biasa ----------------

test('video tanpa groupId dianggap milik grup bawaan', () => {
  // Semua data yang ada sebelum grup ada memang milik brand pertama.
  assert.strictEqual(grupDari({ id: 'vid_1' }, BAWAAN), BAWAAN);
  assert.strictEqual(grupDari({ id: 'vid_2', groupId: 'grp_kopi' }, BAWAAN), 'grp_kopi');
});

test('saring hanya meloloskan milik grup yang diminta', () => {
  const videos = [
    { id: 'v1' },                        // warisan lama
    { id: 'v2', groupId: BAWAAN },
    { id: 'v3', groupId: 'grp_kopi' }
  ];
  assert.deepStrictEqual(saring(videos, BAWAAN, BAWAAN).map((v) => v.id), ['v1', 'v2']);
  assert.deepStrictEqual(saring(videos, 'grp_kopi', BAWAAN).map((v) => v.id), ['v3']);
});

test('set bertanda semuaGrup ikut di setiap grup', () => {
  const set = { id: 'hs_umum', semuaGrup: true, groupId: BAWAAN };
  assert.strictEqual(milikGrup(set, BAWAAN, BAWAAN), true);
  assert.strictEqual(milikGrup(set, 'grp_kopi', BAWAAN), true);
  assert.strictEqual(milikGrup(set, 'grp_apa_saja', BAWAAN), true);
});

test('grup yang tidak dikenal tidak meloloskan seluruh daftar', () => {
  // Kalau id asing diperlakukan sebagai "tanpa saringan", isi semua brand
  // akan tampil sekaligus — persis yang mau dicegah.
  const videos = [{ id: 'v1', groupId: BAWAAN }, { id: 'v2', groupId: 'grp_kopi' }];
  assert.deepStrictEqual(saring(videos, 'grp_tidak_ada', BAWAAN), []);
});

// ---------------- channel: aturannya sengaja berbeda ----------------

test('PENTING: channel tanpa groupId tidak masuk grup mana pun', () => {
  // Channel baru datang dari Buffer, bukan dari migrasi. Diam-diam
  // memasukkannya ke grup bawaan = konten brand lama terkirim ke brand baru.
  const channels = [ch('ch_ig', 'IG'), ch('ch_pn', 'Pinterest')];
  const setelan = { ch_ig: { groupId: BAWAAN } };

  assert.strictEqual(grupChannel(ch('ch_pn'), setelan), '');
  assert.deepStrictEqual(saringChannel(channels, BAWAAN, setelan).map((c) => c.id), ['ch_ig']);
  assert.deepStrictEqual(saringChannel(channels, 'grp_kopi', setelan), []);
});

test('channel tanpa grup tetap bisa didaftar supaya tidak hilang tanpa jejak', () => {
  const channels = [ch('ch_ig', 'IG'), ch('ch_tt', 'TikTok baru')];
  const setelan = { ch_ig: { groupId: BAWAAN } };
  assert.deepStrictEqual(channelTanpaGrup(channels, setelan).map((c) => c.label), ['TikTok baru']);
});

// ---------------- penjaga campuran ----------------

const nama = { [BAWAAN]: 'Arachynana', grp_kopi: 'Kopi Kita' };

test('video grup A + channel grup B ditolak', () => {
  const hasil = periksaCampuran({
    videos: [{ id: 'v1', groupId: BAWAAN }],
    channels: [ch('ch_kopi', 'IG Kopi')],
    setelanChannel: { ch_kopi: { groupId: 'grp_kopi' } },
    bawaanId: BAWAAN,
    namaGrup: nama
  });

  assert.strictEqual(hasil.ok, false);
  assert.match(hasil.pesan, /Arachynana/);
  assert.match(hasil.pesan, /Kopi Kita/);
});

test('video dari dua grup sekaligus ditolak', () => {
  const hasil = periksaCampuran({
    videos: [{ id: 'v1', groupId: BAWAAN }, { id: 'v2', groupId: 'grp_kopi' }],
    channels: [],
    bawaanId: BAWAAN,
    namaGrup: nama
  });
  assert.strictEqual(hasil.ok, false);
  assert.match(hasil.pesan, /2 grup berbeda/);
});

test('channel dari dua grup sekaligus ditolak', () => {
  const hasil = periksaCampuran({
    videos: [{ id: 'v1', groupId: BAWAAN }],
    channels: [ch('ch_a', 'IG'), ch('ch_b', 'IG Kopi')],
    setelanChannel: { ch_a: { groupId: BAWAAN }, ch_b: { groupId: 'grp_kopi' } },
    bawaanId: BAWAAN,
    namaGrup: nama
  });
  assert.strictEqual(hasil.ok, false);
  assert.match(hasil.pesan, /2 grup berbeda/);
});

test('channel yang belum punya grup ikut ditahan, dengan menyebut namanya', () => {
  const hasil = periksaCampuran({
    videos: [{ id: 'v1', groupId: BAWAAN }],
    channels: [ch('ch_a', 'IG'), ch('ch_baru', 'TikTok baru')],
    setelanChannel: { ch_a: { groupId: BAWAAN } },
    bawaanId: BAWAAN,
    namaGrup: nama
  });
  assert.strictEqual(hasil.ok, false);
  assert.match(hasil.pesan, /TikTok baru/);
  assert.deepStrictEqual(hasil.tanpaGrup, ['TikTok baru']);
});

test('satu grup yang sama diloloskan', () => {
  const hasil = periksaCampuran({
    videos: [{ id: 'v1' }, { id: 'v2', groupId: BAWAAN }],
    channels: [ch('ch_a', 'IG'), ch('ch_b', 'TikTok')],
    setelanChannel: { ch_a: { groupId: BAWAAN }, ch_b: { groupId: BAWAAN } },
    bawaanId: BAWAAN,
    namaGrup: nama
  });
  assert.strictEqual(hasil.ok, true);
  assert.strictEqual(hasil.pesan, null);
  assert.deepStrictEqual(hasil.grupVideo, [BAWAAN]);
});
