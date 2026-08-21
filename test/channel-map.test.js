const test = require('node:test');
const assert = require('node:assert');
const { cariPengganti, alihkanItem } = require('../lib/channel-map');

const ch = (id, platform, account, label) => ({ id, platform, account, label });
const item = (channelId, platform, account, status = 'draft') => ({
  channelId, platform, account, channelLabel: `${platform} lama`, status
});

// Skenario nyata: Pinterest diputus lalu disambungkan ulang di Buffer,
// sehingga ID-nya berubah dari ch_pn menjadi ch_pn_baru.

test('channel yang hilang terdeteksi, dengan pengganti yang yakin', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('ch_ig', 'instagram', 'A', 'IG'), ch('ch_pn_baru', 'pinterest', 'B', 'Pinterest bisnis')],
    setelanTersimpan: { ch_pn: { boardId: 'board-lama' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B'), item('ch_ig', 'instagram', 'A')]
  });

  assert.strictEqual(temuan.length, 1);
  assert.strictEqual(temuan[0].lama.id, 'ch_pn');
  assert.strictEqual(temuan[0].yakin, true);
  assert.deepStrictEqual(temuan[0].kandidat.map((c) => c.id), ['ch_pn_baru']);
  assert.strictEqual(temuan[0].punyaSetelan, true);
  assert.strictEqual(temuan[0].itemBelumTerkirim, 1);
});

test('channel yang masih ada tidak dianggap yatim', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('ch_ig', 'instagram', 'A', 'IG')],
    setelanTersimpan: { ch_ig: { hour: '09:00' } },
    itemJadwal: [item('ch_ig', 'instagram', 'A')]
  });
  assert.deepStrictEqual(temuan, []);
});

test('PENGAMAN: daftar channel kosong tidak boleh membuat semuanya dinyatakan yatim', () => {
  // Ini yang terjadi kalau token bermasalah dan channel gagal dibaca.
  const temuan = cariPengganti({
    channelsSekarang: [],
    setelanTersimpan: { ch_pn: { boardId: 'b1' }, ch_ig: { hour: '09:00' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B'), item('ch_ig', 'instagram', 'A')]
  });
  assert.deepStrictEqual(temuan, [], 'jangan melaporkan apa pun saat daftar channel gagal dibaca');
});

test('dua kandidat sepadan: ditawarkan keduanya, tidak diputuskan sendiri', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('pn_1', 'pinterest', 'B', 'Pinterest satu'), ch('pn_2', 'pinterest', 'B', 'Pinterest dua')],
    setelanTersimpan: { ch_pn: { boardId: 'b1' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B')]
  });
  assert.strictEqual(temuan[0].yakin, false);
  assert.strictEqual(temuan[0].kandidat.length, 2);
});

test('kandidat dibatasi ke platform DAN akun yang sama', () => {
  const temuan = cariPengganti({
    channelsSekarang: [
      ch('pn_akun_lain', 'pinterest', 'A', 'Pinterest akun A'),
      ch('ig_baru', 'instagram', 'B', 'IG')
    ],
    setelanTersimpan: { ch_pn: { boardId: 'b1' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B')]
  });
  assert.deepStrictEqual(temuan[0].kandidat, [], 'beda akun & beda platform bukan pengganti');
  assert.strictEqual(temuan[0].yakin, false);
});

test('channel yang sudah punya setelan tidak ditawarkan sebagai pengganti', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('pn_baru', 'pinterest', 'B', 'Pinterest baru')],
    setelanTersimpan: { ch_pn: { boardId: 'b1' }, pn_baru: { boardId: 'sudah-diatur' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B')]
  });
  assert.deepStrictEqual(temuan[0].kandidat, [], 'channel yang sudah dipakai jangan ditimpa');
});

test('setelan yatim tanpa jejak jadwal tetap dilaporkan, tapi tidak yakin', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('pn_baru', 'pinterest', 'B', 'Pinterest baru')],
    setelanTersimpan: { ch_entah: { boardId: 'b1' } },
    itemJadwal: []
  });
  assert.strictEqual(temuan.length, 1);
  assert.strictEqual(temuan[0].lama.platform, null, 'platformnya memang tidak bisa diketahui');
  assert.strictEqual(temuan[0].yakin, false);
  assert.strictEqual(temuan[0].kandidat.length, 1, 'semua channel bebas ditawarkan untuk dipilih');
});

// ---------- pengalihan item ----------

test('hanya item yang belum terkirim yang dialihkan', () => {
  const plans = [{
    id: 'p1', channelIds: ['ch_pn', 'ch_ig'],
    items: [
      item('ch_pn', 'pinterest', 'B', 'sent'),
      item('ch_pn', 'pinterest', 'B', 'draft'),
      item('ch_pn', 'pinterest', 'B', 'error'),
      item('ch_ig', 'instagram', 'A', 'draft')
    ]
  }];

  const hasil = alihkanItem(plans, 'ch_pn', ch('pn_baru', 'pinterest', 'B', 'Pinterest bisnis'));

  assert.strictEqual(hasil.diubah, 2, 'draft + error ikut pindah');
  assert.strictEqual(hasil.dilewati, 1, 'yang sudah sent tidak disentuh');

  assert.strictEqual(plans[0].items[0].channelId, 'ch_pn', 'catatan sejarah item terkirim harus utuh');
  assert.strictEqual(plans[0].items[1].channelId, 'pn_baru');
  assert.strictEqual(plans[0].items[1].channelLabel, 'Pinterest bisnis');
  assert.strictEqual(plans[0].items[3].channelId, 'ch_ig', 'channel lain tidak ikut berubah');
  assert.deepStrictEqual(plans[0].channelIds, ['pn_baru', 'ch_ig']);
});

test('mengalihkan channel yang tidak dipakai tidak mengubah apa pun', () => {
  const plans = [{ id: 'p1', channelIds: ['ch_ig'], items: [item('ch_ig', 'instagram', 'A')] }];
  const hasil = alihkanItem(plans, 'ch_entah', ch('baru', 'pinterest', 'B', 'X'));
  assert.deepStrictEqual(hasil, { diubah: 0, dilewati: 0 });
  assert.strictEqual(plans[0].items[0].channelId, 'ch_ig');
});

test('channel yang hanya disebut item TERKIRIM tidak dilaporkan lagi', () => {
  // Sesudah dipindahkan, item yang sudah sent sengaja tetap menunjuk id lama.
  // Kalau itu terus dianggap yatim, peringatannya tidak akan pernah hilang.
  const temuan = cariPengganti({
    channelsSekarang: [ch('pn_baru', 'pinterest', 'B', 'Pinterest bisnis')],
    setelanTersimpan: { pn_baru: { boardId: 'b1' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B', 'sent')]
  });
  assert.deepStrictEqual(temuan, [], 'tidak ada lagi yang perlu ditindak');
});

test('masih dilaporkan selama ada item belum terkirim, walau setelannya sudah pindah', () => {
  const temuan = cariPengganti({
    channelsSekarang: [ch('pn_baru', 'pinterest', 'B', 'Pinterest bisnis')],
    setelanTersimpan: { pn_baru: { boardId: 'b1' } },
    itemJadwal: [item('ch_pn', 'pinterest', 'B', 'sent'), item('ch_pn', 'pinterest', 'B', 'draft')]
  });
  assert.strictEqual(temuan.length, 1);
  assert.strictEqual(temuan[0].itemBelumTerkirim, 1);
});
