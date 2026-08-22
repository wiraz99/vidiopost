/**
 * Grup = satu brand beserta miliknya: video, channel, hashtag, tautan, jadwal.
 *
 * Sebelum ini seluruh aplikasi mengasumsikan satu brand. Nama brand bahkan
 * terkunci sebagai konstanta di lib/ai.js, jadi caption untuk brand kedua akan
 * tetap menyebut brand pertama. Grup memindahkan brand dari environment ke
 * data, sehingga satu deployment bisa melayani beberapa brand tanpa isinya
 * saling tercampur.
 *
 * Aturan siapa-milik-siapa ada di lib/group-scope.js (murni, mudah diuji).
 * Modul ini yang menyentuh disk.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

// Dibaca saat dipakai, bukan saat modul dimuat, supaya test bisa menyetelnya.
const envBrand = () => ({
  brand: process.env.BRAND_NAME || 'Arachynana',
  product: process.env.BRAND_PRODUCT || 'Sale Pisang Granola'
});

const WARNA = ['#0f766e', '#b45309', '#4f46e5', '#be123c', '#0369a1', '#4d7c0f'];

class GroupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------- migrasi sekali jalan ----------------

// File yang isinya ikut distempel grup bawaan saat migrasi pertama.
const FILE_DISTEMPEL = ['videos', 'hashtags', 'links', 'plans'];

/** Salin file apa adanya sebelum disentuh. Data ini hidup di volume Coolify. */
function cadangkan(nama) {
  const asal = path.join(store.DATA_DIR, `${nama}.json`);
  const tujuan = path.join(store.DATA_DIR, `${nama}.sebelum-grup.json`);
  if (!fs.existsSync(asal) || fs.existsSync(tujuan)) return false;
  fs.copyFileSync(asal, tujuan);
  return true;
}

/**
 * Buat grup pertama dan akui semua isi lama sebagai miliknya.
 *
 * Dijalankan sekali; keberadaan groups.json yang jadi penandanya. Channel ikut
 * distempel dari channels-cache.json — kalau tidak, keenam channel yang sudah
 * jalan akan mendadak dianggap "belum punya grup" dan hilang dari halaman
 * jadwal sampai ditetapkan satu per satu.
 */
function migrasi() {
  const env = envBrand();
  const grup = {
    id: 'grp_utama',
    name: env.brand,
    brand: env.brand,
    product: env.product,
    warna: WARNA[0],
    isDefault: true,
    createdAt: new Date().toISOString()
  };

  const laporan = { grup, dicadangkan: [], distempel: {}, channel: 0 };

  for (const nama of FILE_DISTEMPEL) {
    if (cadangkan(nama)) laporan.dicadangkan.push(nama);
    const isi = store.read(nama, null);
    if (!Array.isArray(isi)) continue;
    let n = 0;
    for (const x of isi) {
      if (!x.groupId) { x.groupId = grup.id; n++; }
    }
    if (n) store.write(nama, isi);
    laporan.distempel[nama] = n;
  }

  if (cadangkan('channel-settings')) laporan.dicadangkan.push('channel-settings');
  const setelan = store.read('channel-settings', {});
  const cache = store.read('channels-cache', null);
  for (const c of cache?.channels || []) {
    if (setelan[c.id]?.groupId) continue;
    setelan[c.id] = { ...(setelan[c.id] || {}), groupId: grup.id };
    laporan.channel++;
  }
  // Setelan channel yang sudah ada tapi channelnya tidak lagi terdaftar tetap
  // ikut distempel: kalau nanti channelnya muncul lagi, grupnya sudah benar.
  for (const [id, s] of Object.entries(setelan)) {
    if (!s.groupId) { setelan[id] = { ...s, groupId: grup.id }; laporan.channel++; }
  }
  store.write('channel-settings', setelan);

  store.write('groups', [grup]);
  return laporan;
}

// ---------------- baca ----------------

/** Daftar grup. Menjalankan migrasi kalau ini pemakaian pertama. */
function daftar() {
  const ada = store.read('groups', null);
  if (Array.isArray(ada) && ada.length) return ada;
  migrasi();
  return store.read('groups', []);
}

/** Grup bawaan: yang bertanda isDefault, kalau tidak ada ambil yang pertama. */
const bawaan = () => {
  const semua = daftar();
  return semua.find((g) => g.isDefault) || semua[0] || null;
};

const bawaanId = () => bawaan()?.id || '';

const cari = (id) => daftar().find((g) => g.id === id) || null;

/** Peta id ke nama, untuk pesan error yang menyebut nama, bukan id. */
const petaNama = () => Object.fromEntries(daftar().map((g) => [g.id, g.name]));

/**
 * Grup mana yang sedang diminta.
 *
 * `semua` melewati saringan (dipakai halaman Pengaturan). Id yang tidak dikenal
 * TIDAK dibiarkan lolos jadi "tanpa saringan" — itu akan menampilkan isi semua
 * brand sekaligus. Dikembalikan ke grup bawaan, dengan penanda supaya frontend
 * bisa membereskan pilihannya yang basi.
 */
function resolusi(raw) {
  if (raw === 'semua') return { id: 'semua', semua: true, tidakDikenal: false };
  if (!raw) return { id: bawaanId(), semua: false, tidakDikenal: false };
  const ketemu = daftar().find((g) => g.id === raw);
  if (ketemu) return { id: ketemu.id, semua: false, tidakDikenal: false };
  return { id: bawaanId(), semua: false, tidakDikenal: true };
}

/** Brand & produk untuk prompt AI. Grup yang tidak mengisinya ikut environment. */
function brandUntuk(groupId) {
  const g = cari(groupId) || bawaan();
  const env = envBrand();
  return {
    brand: g?.brand || env.brand,
    product: g?.product || env.product
  };
}

/** Grup tiap channel, dibaca dari channel-settings.json. */
const setelanChannel = () => store.read('channel-settings', {});

// ---------------- tulis ----------------

const bersihNama = (v) => String(v ?? '').trim();

function buat({ name, brand, product, warna } = {}) {
  const nama = bersihNama(name);
  if (!nama) throw new GroupError('Nama grup wajib diisi');

  const semua = daftar();
  if (semua.some((g) => g.name.toLowerCase() === nama.toLowerCase())) {
    throw new GroupError(`Sudah ada grup bernama "${nama}".`);
  }

  const grup = {
    id: store.uid('grp'),
    name: nama,
    brand: bersihNama(brand) || nama,
    product: bersihNama(product),
    warna: bersihNama(warna) || WARNA[semua.length % WARNA.length],
    isDefault: false,
    createdAt: new Date().toISOString()
  };
  semua.push(grup);
  store.write('groups', semua);
  return grup;
}

function ubah(id, patch = {}) {
  const semua = daftar();
  const grup = semua.find((g) => g.id === id);
  if (!grup) throw new GroupError('Grup tidak ditemukan', 404);

  if (patch.name !== undefined) {
    const nama = bersihNama(patch.name);
    if (!nama) throw new GroupError('Nama grup wajib diisi');
    if (semua.some((g) => g.id !== id && g.name.toLowerCase() === nama.toLowerCase())) {
      throw new GroupError(`Sudah ada grup bernama "${nama}".`);
    }
    grup.name = nama;
  }
  for (const key of ['brand', 'product', 'warna']) {
    if (patch[key] !== undefined) grup[key] = bersihNama(patch[key]);
  }
  if (patch.isDefault === true) for (const g of semua) g.isDefault = g.id === id;

  store.write('groups', semua);
  return grup;
}

/** Apa saja yang masih menunjuk grup ini. Dipakai untuk menahan penghapusan. */
function pemakai(id) {
  const hitung = (nama) => store.read(nama, []).filter((x) => x.groupId === id).length;
  const channel = Object.values(setelanChannel()).filter((s) => s?.groupId === id).length;
  return {
    video: hitung('videos'),
    jadwal: hitung('plans'),
    hashtag: hitung('hashtags'),
    tautan: hitung('links'),
    channel
  };
}

function hapus(id) {
  const semua = daftar();
  const grup = semua.find((g) => g.id === id);
  if (!grup) throw new GroupError('Grup tidak ditemukan', 404);
  if (semua.length === 1) throw new GroupError('Ini satu-satunya grup — tidak bisa dihapus.');

  const dipakai = pemakai(id);
  const rincian = Object.entries(dipakai)
    .filter(([, n]) => n > 0)
    .map(([apa, n]) => `${n} ${apa}`);

  if (rincian.length) {
    throw new GroupError(
      `Grup "${grup.name}" masih dipakai: ${rincian.join(', ')}. ` +
      'Pindahkan atau hapus dulu isinya, baru grupnya bisa dihapus.'
    );
  }

  const sisa = semua.filter((g) => g.id !== id);
  // Grup bawaan tidak boleh ikut hilang tanpa pengganti.
  if (grup.isDefault && sisa.length) sisa[0].isDefault = true;
  store.write('groups', sisa);
  return { ok: true, dihapus: grup };
}

module.exports = {
  daftar,
  bawaan,
  bawaanId,
  cari,
  petaNama,
  resolusi,
  brandUntuk,
  setelanChannel,
  buat,
  ubah,
  hapus,
  pemakai,
  migrasi,
  WARNA,
  GroupError
};
