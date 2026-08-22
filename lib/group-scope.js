/**
 * Menentukan apa milik grup mana.
 *
 * Aplikasi ini semula menganggap seluruh isinya milik satu brand. Begitu ada
 * brand kedua di deployment yang sama, satu kesalahan kecil di sini berarti
 * video brand A tayang di channel brand B — kesalahan yang baru ketahuan
 * setelah post-nya terbit dan tidak bisa ditarik lagi.
 *
 * Karena itu modul ini sengaja MURNI (tanpa baca/tulis file), seperti
 * lib/channel-map.js: aturannya bisa diuji langsung tanpa menyiapkan apa pun.
 *
 * DUA ATURAN YANG SENGAJA BERBEDA
 *
 *   video / hashtag / tautan / jadwal tanpa groupId  ->  grup bawaan
 *   channel tanpa groupId                            ->  BELUM PUNYA GRUP
 *
 * Untuk empat yang pertama, "tidak ada grup" selalu berarti data lama dari
 * masa sebelum grup ada — dan semuanya memang milik brand pertama.
 *
 * Channel tidak boleh begitu. Channel baru datang dari Buffer, bukan dari
 * migrasi, dan diam-diam memasukkannya ke grup bawaan persis menghasilkan
 * kesalahan yang mau dicegah: channel brand baru ikut terkirimi konten brand
 * lama. Jadi channel tanpa grup tidak masuk grup mana pun, dan ditampilkan
 * mencolok sampai orangnya menetapkan.
 */

/** Grup sebuah entitas biasa. Kosong = warisan lama = grup bawaan. */
const grupDari = (entitas, bawaanId) => entitas?.groupId || bawaanId || '';

/**
 * Grup sebuah channel. TIDAK jatuh ke grup bawaan — lihat catatan di atas.
 * @param {object} channel  { id, ... } dari Buffer
 * @param {object} setelan  isi channel-settings.json
 */
const grupChannel = (channel, setelan = {}) => setelan?.[channel?.id]?.groupId || '';

/**
 * Apakah entitas ikut ditampilkan saat grup tertentu sedang aktif.
 * `semuaGrup: true` (set hashtag & tautan umum) selalu ikut.
 */
const milikGrup = (entitas, groupId, bawaanId) =>
  entitas?.semuaGrup === true || grupDari(entitas, bawaanId) === groupId;

/** Saring daftar entitas biasa ke satu grup. */
const saring = (daftar, groupId, bawaanId) =>
  (daftar || []).filter((x) => milikGrup(x, groupId, bawaanId));

/** Saring daftar channel ke satu grup. Channel tanpa grup tidak pernah ikut. */
const saringChannel = (channels, groupId, setelan = {}) =>
  (channels || []).filter((c) => grupChannel(c, setelan) === groupId);

/** Channel yang belum ditetapkan grupnya — perlu ditampilkan, bukan disembunyikan. */
const channelTanpaGrup = (channels, setelan = {}) =>
  (channels || []).filter((c) => !grupChannel(c, setelan));

/**
 * Apakah pilihan video + channel ini bercampur antar grup?
 *
 * Menyembunyikan channel grup lain dari layar saja tidak cukup: jadwal lama
 * bisa dibuka lagi, channel bisa dipindah grup sesudah jadwalnya jadi, dan API
 * bisa dipanggil langsung. Ini penjaga yang tidak bergantung pada tampilan.
 *
 * @returns {{ok:boolean, grupVideo:string[], grupChannel:string[], tanpaGrup:string[], pesan:string|null}}
 */
function periksaCampuran({ videos = [], channels = [], setelanChannel = {}, bawaanId = '', namaGrup = {} } = {}) {
  const grupVideo = [...new Set(videos.map((v) => grupDari(v, bawaanId)).filter(Boolean))];

  const grupCh = new Set();
  const tanpaGrup = [];
  for (const c of channels) {
    const g = grupChannel(c, setelanChannel);
    if (g) grupCh.add(g);
    else tanpaGrup.push(c.label || c.id);
  }
  const grupChannelList = [...grupCh];

  const nama = (id) => namaGrup[id] || id;
  const gabung = (ids) => ids.map(nama).join(', ');

  if (grupVideo.length > 1) {
    return {
      ok: false,
      grupVideo,
      grupChannel: grupChannelList,
      tanpaGrup,
      pesan: `Video yang dipilih berasal dari ${grupVideo.length} grup berbeda (${gabung(grupVideo)}). ` +
        'Satu jadwal hanya boleh berisi satu grup.'
    };
  }

  if (grupChannelList.length > 1) {
    return {
      ok: false,
      grupVideo,
      grupChannel: grupChannelList,
      tanpaGrup,
      pesan: `Channel yang dipilih berasal dari ${grupChannelList.length} grup berbeda (${gabung(grupChannelList)}). ` +
        'Satu jadwal hanya boleh berisi satu grup.'
    };
  }

  if (grupVideo.length && grupChannelList.length && grupVideo[0] !== grupChannelList[0]) {
    return {
      ok: false,
      grupVideo,
      grupChannel: grupChannelList,
      tanpaGrup,
      pesan: `Videonya milik grup "${nama(grupVideo[0])}" tapi channelnya milik grup ` +
        `"${nama(grupChannelList[0])}". Post ini akan tayang di brand yang salah.`
    };
  }

  if (tanpaGrup.length) {
    return {
      ok: false,
      grupVideo,
      grupChannel: grupChannelList,
      tanpaGrup,
      pesan: `Channel ${tanpaGrup.join(', ')} belum ditetapkan grupnya. ` +
        'Tetapkan dulu di Pengaturan supaya jelas brand mana yang memakainya.'
    };
  }

  return { ok: true, grupVideo, grupChannel: grupChannelList, tanpaGrup, pesan: null };
}

module.exports = {
  grupDari,
  grupChannel,
  milikGrup,
  saring,
  saringChannel,
  channelTanpaGrup,
  periksaCampuran
};
