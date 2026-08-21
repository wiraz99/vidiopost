/**
 * Menghubungkan channel lama yang sudah tidak ada dengan penggantinya.
 *
 * Menyambung ulang sebuah channel di Buffer (misalnya waktu mengubah Pinterest
 * jadi akun bisnis) membuat Buffer memberi CHANNEL ID BARU. Akibatnya dua hal
 * menggantung di aplikasi ini:
 *
 *   - entri di channel-settings.json (board Pinterest, jam tayang) yang
 *     berkunci ID lama — jadi setelannya seolah hilang
 *   - item jadwal yang belum terkirim yang masih menunjuk ID lama — nanti
 *     ditolak Buffer saat waktunya tayang
 *
 * Modul ini sengaja MURNI (tanpa baca/tulis file) supaya gampang dites: dua
 * kesalahan di sini akibatnya berat — setelan bisa nyasar ke channel orang lain
 * platform, atau jadwal yang sudah benar malah ikut diubah.
 */

/** Kunci setelan yang dianggap "sudah dipakai" — bukan sekadar objek kosong. */
const punyaIsi = (setelan) => !!setelan && Object.keys(setelan).length > 0;

/**
 * Cari channel lama yang sudah tidak ada, beserta calon penggantinya.
 *
 * @param {object[]} channelsSekarang  daftar channel hidup: { id, platform, account, label }
 * @param {object}   setelanTersimpan  isi channel-settings.json
 * @param {object[]} itemJadwal        semua item dari semua jadwal
 * @returns {object[]} temuan, kosong kalau tidak ada yang menggantung
 */
function cariPengganti({ channelsSekarang = [], setelanTersimpan = {}, itemJadwal = [] } = {}) {
  // PENGAMAN: daftar channel kosong hampir selalu berarti gagal dibaca (token
  // bermasalah), bukan "semua channel benar-benar hilang". Kalau diteruskan,
  // seluruh setelan dan jadwal akan dinyatakan yatim — jauh lebih merusak
  // daripada tidak melaporkan apa-apa.
  if (!channelsSekarang.length) return [];

  const hidup = new Set(channelsSekarang.map((c) => c.id));

  // Keterangan channel lama hanya bisa didapat dari item jadwal;
  // channel-settings.json cuma menyimpan idnya saja.
  const keterangan = new Map();
  const belumTerkirim = new Map();

  for (const item of itemJadwal) {
    if (!item?.channelId || hidup.has(item.channelId)) continue;
    if (!keterangan.has(item.channelId)) {
      keterangan.set(item.channelId, {
        id: item.channelId,
        platform: item.platform || null,
        account: item.account || null,
        label: item.channelLabel || item.channelId
      });
    }
    if (item.status !== 'sent') {
      belumTerkirim.set(item.channelId, (belumTerkirim.get(item.channelId) || 0) + 1);
    }
  }

  // Kandidat pengganti hanyalah channel yang belum punya setelan sendiri —
  // channel yang sudah dipakai jangan sampai ditimpa.
  const belumDiklaim = channelsSekarang.filter((c) => !punyaIsi(setelanTersimpan[c.id]));

  const yatim = new Set([
    ...Object.keys(setelanTersimpan).filter((id) => punyaIsi(setelanTersimpan[id]) && !hidup.has(id)),
    ...keterangan.keys()
  ]);

  const temuan = [];
  for (const id of yatim) {
    const lama = keterangan.get(id) || { id, platform: null, account: null, label: id };

    // Kalau platformnya diketahui, kandidat dipersempit ke platform + akun yang
    // sama. Kalau tidak (setelan tanpa jejak jadwal), semua channel yang belum
    // diklaim ditawarkan dan user yang memilih.
    const kandidat = lama.platform
      ? belumDiklaim.filter((c) => c.platform === lama.platform && c.account === lama.account)
      : belumDiklaim.slice();

    temuan.push({
      lama,
      kandidat: kandidat.map((c) => ({ id: c.id, platform: c.platform, account: c.account, label: c.label })),
      // "Yakin" hanya kalau platformnya diketahui DAN kandidatnya tepat satu.
      yakin: !!lama.platform && kandidat.length === 1,
      punyaSetelan: punyaIsi(setelanTersimpan[id]),
      itemBelumTerkirim: belumTerkirim.get(id) || 0
    });
  }

  // Channel yang HANYA disebut oleh item yang sudah terkirim bukan lagi masalah:
  // tidak ada setelan yang menggantung dan tidak ada yang perlu dialihkan. Kalau
  // tetap dilaporkan, peringatannya tidak akan pernah hilang meski sudah dibereskan.
  return temuan.filter((t) => t.punyaSetelan || t.itemBelumTerkirim > 0);
}

/**
 * Alihkan item jadwal dari channel lama ke channel baru.
 * Mengubah `plans` di tempat; mengembalikan hitungannya.
 *
 * Item yang sudah `sent` TIDAK disentuh — id lamanya adalah catatan sejarah
 * yang benar tentang ke mana post itu dulu dikirim.
 */
function alihkanItem(plans, dari, ke) {
  let diubah = 0;
  let dilewati = 0;

  for (const plan of plans || []) {
    for (const item of plan.items || []) {
      if (item.channelId !== dari) continue;
      if (item.status === 'sent') { dilewati++; continue; }

      item.channelId = ke.id;
      item.channelLabel = ke.label;
      if (ke.account) item.account = ke.account;
      if (ke.platform) item.platform = ke.platform;
      diubah++;
    }
    // Daftar channel milik jadwal ikut disesuaikan supaya ringkasannya benar.
    if (Array.isArray(plan.channelIds)) {
      plan.channelIds = plan.channelIds.map((id) => (id === dari ? ke.id : id));
    }
  }

  return { diubah, dilewati };
}

module.exports = { cariPengganti, alihkanItem };
