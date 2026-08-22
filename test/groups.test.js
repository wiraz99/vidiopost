/**
 * Migrasi ke grup dan penjaga penghapusan.
 *
 * Migrasi menyentuh data yang sedang dipakai di volume permanen, jadi yang
 * diuji bukan cuma "berhasil", tapi juga: tidak ada yang hilang, ada
 * cadangannya, dan menjalankannya dua kali tidak merusak apa pun.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// Harus disetel SEBELUM lib/store diimpor — store menentukan foldernya saat dimuat.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vpa-groups-'));
process.env.DATA_DIR = DIR;
process.env.MEDIA_DIR = DIR;
process.env.BRAND_NAME = 'Arachynana';
process.env.BRAND_PRODUCT = 'Sale Pisang Granola';

const store = require('../lib/store');
const groups = require('../lib/groups');

const tulis = (nama, isi) => store.write(nama, isi);
const baca = (nama) => store.read(nama, null);

/** Keadaan awal: data lama dari masa sebelum grup ada. */
function siapkanDataLama() {
  for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f));
  tulis('videos', [{ id: 'vid_1', title: 'Sale pisang' }, { id: 'vid_2', title: 'Resep' }]);
  tulis('hashtags', [{ id: 'hs_brand', name: 'Brand', tags: ['#Arachynana'] }]);
  tulis('links', [{ id: 'lnk_1', name: 'Toko', url: 'https://contoh.id' }]);
  tulis('plans', [{ id: 'plan_1', items: [] }]);
  tulis('channels-cache', {
    fetchedAt: new Date().toISOString(),
    channels: [
      { id: 'ch_ig', platform: 'instagram', account: 'A', label: 'IG' },
      { id: 'ch_pn', platform: 'pinterest', account: 'B', label: 'Pinterest' }
    ]
  });
  tulis('channel-settings', { ch_pn: { boardId: 'board-111' } });
}

test('migrasi mengakui semua isi lama sebagai milik grup pertama', () => {
  siapkanDataLama();
  const laporan = groups.migrasi();

  assert.strictEqual(laporan.grup.name, 'Arachynana');
  assert.strictEqual(laporan.grup.product, 'Sale Pisang Granola');

  for (const nama of ['videos', 'hashtags', 'links', 'plans']) {
    for (const x of baca(nama)) {
      assert.strictEqual(x.groupId, 'grp_utama', `${nama}: ${x.id} belum distempel`);
    }
  }

  // Channel dari cache ikut distempel — kalau tidak, keenam channel yang sudah
  // jalan mendadak dianggap "belum punya grup" dan hilang dari halaman jadwal.
  const setelan = baca('channel-settings');
  assert.strictEqual(setelan.ch_ig.groupId, 'grp_utama');
  assert.strictEqual(setelan.ch_pn.groupId, 'grp_utama');
  // Setelan yang sudah ada tidak boleh ikut hilang.
  assert.strictEqual(setelan.ch_pn.boardId, 'board-111');
});

test('migrasi meninggalkan cadangan tiap file yang disentuh', () => {
  siapkanDataLama();
  groups.migrasi();

  for (const nama of ['videos', 'hashtags', 'links', 'plans', 'channel-settings']) {
    const cadangan = path.join(DIR, `${nama}.sebelum-grup.json`);
    assert.ok(fs.existsSync(cadangan), `cadangan ${nama} tidak dibuat`);
  }
  // Isi cadangan = keadaan SEBELUM distempel.
  const lama = JSON.parse(fs.readFileSync(path.join(DIR, 'videos.sebelum-grup.json'), 'utf8'));
  assert.strictEqual(lama[0].groupId, undefined);
});

test('migrasi kedua kali tidak mengubah apa pun', () => {
  siapkanDataLama();
  groups.migrasi();
  const sesudahPertama = JSON.stringify(baca('videos'));
  const cadanganPertama = fs.readFileSync(path.join(DIR, 'videos.sebelum-grup.json'), 'utf8');

  groups.migrasi();

  assert.strictEqual(JSON.stringify(baca('videos')), sesudahPertama);
  // Cadangan tidak ditimpa — kalau ditimpa, isinya jadi versi yang sudah
  // distempel dan tidak berguna lagi sebagai jalan pulang.
  assert.strictEqual(fs.readFileSync(path.join(DIR, 'videos.sebelum-grup.json'), 'utf8'), cadanganPertama);
});

test('daftar() menjalankan migrasi sendiri saat pertama dipakai', () => {
  siapkanDataLama();
  const semua = groups.daftar();
  assert.strictEqual(semua.length, 1);
  assert.strictEqual(groups.bawaanId(), 'grp_utama');
  assert.strictEqual(baca('videos')[0].groupId, 'grp_utama');
});

test('grup yang tidak dikenal dikembalikan ke bawaan, dengan penandanya', () => {
  siapkanDataLama();
  groups.daftar();

  assert.deepStrictEqual(groups.resolusi('grp_ngawur'), {
    id: 'grp_utama', semua: false, tidakDikenal: true
  });
  assert.strictEqual(groups.resolusi('semua').semua, true);
  assert.strictEqual(groups.resolusi('').id, 'grp_utama');
});

test('brand mengikuti grup, bukan environment', () => {
  siapkanDataLama();
  const kopi = groups.buat({ name: 'Kopi Kita', product: 'Kopi Robusta' });

  assert.deepStrictEqual(groups.brandUntuk(kopi.id), { brand: 'Kopi Kita', product: 'Kopi Robusta' });
  assert.deepStrictEqual(groups.brandUntuk('grp_utama'), {
    brand: 'Arachynana', product: 'Sale Pisang Granola'
  });
  // Grup tanpa produk sendiri tetap ikut environment, supaya caption yang
  // sekarang tidak berubah sedikit pun.
  const polos = groups.buat({ name: 'Tanpa Produk' });
  assert.strictEqual(groups.brandUntuk(polos.id).product, 'Sale Pisang Granola');
});

test('nama grup tidak boleh kembar', () => {
  siapkanDataLama();
  groups.buat({ name: 'Kopi Kita' });
  assert.throws(() => groups.buat({ name: 'kopi kita' }), /Sudah ada grup/);
});

test('grup yang masih dipakai tidak bisa dihapus, dan alasannya disebut', () => {
  siapkanDataLama();
  const kopi = groups.buat({ name: 'Kopi Kita' });

  const videos = baca('videos');
  videos[0].groupId = kopi.id;
  tulis('videos', videos);
  const setelan = baca('channel-settings');
  setelan.ch_ig.groupId = kopi.id;
  tulis('channel-settings', setelan);

  assert.throws(() => groups.hapus(kopi.id), (err) => {
    assert.match(err.message, /1 video/);
    assert.match(err.message, /1 channel/);
    return true;
  });

  // Setelah isinya dikosongkan, baru boleh dihapus.
  videos[0].groupId = 'grp_utama';
  tulis('videos', videos);
  setelan.ch_ig.groupId = 'grp_utama';
  tulis('channel-settings', setelan);
  assert.strictEqual(groups.hapus(kopi.id).ok, true);
});

test('grup terakhir tidak bisa dihapus', () => {
  siapkanDataLama();
  groups.daftar();
  assert.throws(() => groups.hapus('grp_utama'), /satu-satunya grup/);
});

test('menghapus grup bawaan memindahkan tanda bawaan, bukan menghilangkannya', () => {
  siapkanDataLama();
  const kopi = groups.buat({ name: 'Kopi Kita' });
  // Kosongkan grup utama supaya boleh dihapus.
  for (const nama of ['videos', 'hashtags', 'links', 'plans']) {
    tulis(nama, baca(nama).map((x) => ({ ...x, groupId: kopi.id })));
  }
  tulis('channel-settings', Object.fromEntries(
    Object.entries(baca('channel-settings')).map(([id, s]) => [id, { ...s, groupId: kopi.id }])
  ));

  groups.hapus('grp_utama');
  assert.strictEqual(groups.bawaanId(), kopi.id);
});
