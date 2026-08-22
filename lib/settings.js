/**
 * Setelan aplikasi.
 *
 * Sebelumnya tipe post Instagram, kategori YouTube, privasi, board Pinterest dan
 * zona waktu semuanya hidup sebagai environment variable. Itu keputusan yang
 * salah tempat: semuanya adalah setelan PER CHANNEL, bukan konfigurasi server.
 * Akibatnya tiap kali mau ganti kategori YouTube harus buka Coolify dan deploy
 * ulang seluruh aplikasi.
 *
 * Sekarang urutan pengambilannya:
 *
 *     setelan channel  →  setelan umum  →  environment variable  →  bawaan kode
 *
 * Environment variable tetap dihormati supaya deployment yang sudah jalan tidak
 * berubah perilakunya begitu versi ini naik; dia sekarang jadi lapisan bawaan,
 * bukan satu-satunya cara.
 *
 * Bentuk penyimpanannya sengaja sudah berdimensi pemilik sejak sekarang
 * (lihat store 'app-settings'), supaya menambahkan multi-user nanti tidak perlu
 * menulis ulang bagian ini.
 */
const store = require('./store');

const PLATFORM_POST_TYPES = ['reel', 'post', 'story'];
const YOUTUBE_PRIVACY = ['public', 'unlisted', 'private'];

/** Lapisan paling bawah: env kalau ada, kalau tidak bawaan kode. */
const envDefaults = () => ({
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  instagramType: process.env.INSTAGRAM_POST_TYPE || 'reel',
  facebookType: process.env.FACEBOOK_POST_TYPE || 'reel',
  instagramShareToFeed: process.env.INSTAGRAM_SHARE_TO_FEED !== 'false',
  youtubeCategoryId: process.env.YOUTUBE_CATEGORY_ID || '26',
  youtubePrivacy: process.env.YOUTUBE_PRIVACY || 'public',
  boardId: process.env.PINTEREST_BOARD_ID || ''
});

// Yang boleh disimpan sebagai setelan umum (berlaku untuk semua channel).
const GLOBAL_KEYS = [
  'timezone', 'instagramType', 'facebookType', 'instagramShareToFeed',
  'youtubeCategoryId', 'youtubePrivacy'
];

// Yang boleh ditimpa per channel. `hour` = jam tayang bawaan channel itu.
//
// `groupId` menumpang di sini, bukan di file sendiri, karena pemindahan setelan
// saat channel disambungkan ulang di Buffer menyalin seluruh objek ini — jadi
// grup channel ikut berpindah tanpa kode tambahan.
const CHANNEL_KEYS = [
  'boardId', 'hour', 'groupId', 'instagramType', 'facebookType', 'instagramShareToFeed',
  'youtubeCategoryId', 'youtubePrivacy'
];

/** Buang nilai kosong supaya tidak menimpa lapisan di bawahnya dengan "tidak diisi". */
function bersih(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

const readGlobalRaw = () => store.read('app-settings', {});
const readChannelsRaw = () => store.read('channel-settings', {});

/** Setelan umum yang sudah digabung dengan lapisan bawaan. */
const globalSettings = () => ({ ...envDefaults(), ...bersih(readGlobalRaw()) });

/** Setelan efektif untuk satu channel. Inilah yang dipakai saat menyusun post. */
const forChannel = (channelId) => ({
  ...globalSettings(),
  ...bersih(readChannelsRaw()[channelId])
});

/** Jam tayang bawaan tiap channel: { [channelId]: 'HH:mm' } */
function channelHours() {
  const out = {};
  for (const [id, setelan] of Object.entries(readChannelsRaw())) {
    if (setelan?.hour) out[id] = setelan.hour;
  }
  return out;
}

// ---------------- validasi ----------------

class SettingError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Zona waktu diuji ke Intl — salah ketik di sini bikin SEMUA jadwal meleset. */
function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const VALIDATOR = {
  timezone: (v) => {
    if (!validTimezone(v)) throw new SettingError(`Zona waktu "${v}" tidak dikenali.`);
    return String(v);
  },
  instagramType: (v) => pilihan('Tipe post Instagram', v, PLATFORM_POST_TYPES),
  facebookType: (v) => pilihan('Tipe post Facebook', v, PLATFORM_POST_TYPES),
  instagramShareToFeed: (v) => v === true || v === 'true',
  youtubeCategoryId: (v) => {
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new SettingError('ID kategori YouTube harus berupa angka.');
    return s;
  },
  youtubePrivacy: (v) => pilihan('Privasi YouTube', v, YOUTUBE_PRIVACY),
  boardId: (v) => String(v ?? '').trim(),
  // Grup yang tidak ada berarti channel ini jadi yatim: tidak muncul di grup
  // mana pun dan tidak bisa dipakai menjadwalkan apa pun. Ditolak di sini.
  groupId: (v) => {
    const s = String(v ?? '').trim();
    // require di dalam fungsi: lib/groups memakai store yang juga dipakai modul
    // ini, dan menariknya di atas membuat urutan pemuatannya rapuh.
    if (s && !require('./groups').cari(s)) throw new SettingError(`Grup "${s}" tidak ada.`);
    return s;
  },
  hour: (v) => {
    const s = String(v ?? '').trim();
    if (s && !/^\d{2}:\d{2}$/.test(s)) throw new SettingError('Jam tayang harus berformat HH:mm.');
    return s;
  }
};

function pilihan(label, value, daftar) {
  const s = String(value);
  if (!daftar.includes(s)) throw new SettingError(`${label} harus salah satu dari: ${daftar.join(', ')}.`);
  return s;
}

/** Saring + validasi patch, hanya untuk kunci yang diizinkan. */
function sanitize(patch, allowed) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.includes(key)) continue;
    // Nilai kosong = "kembalikan ke bawaan", jadi disimpan sebagai penghapusan.
    if (value === null || value === '') {
      out[key] = '';
      continue;
    }
    out[key] = VALIDATOR[key] ? VALIDATOR[key](value) : value;
  }
  return out;
}

function saveGlobal(patch) {
  const bersihkan = sanitize(patch, GLOBAL_KEYS);
  const next = { ...readGlobalRaw(), ...bersihkan };
  // Kunci yang dikosongkan benar-benar dibuang, bukan disimpan sebagai ''.
  for (const [key, value] of Object.entries(next)) if (value === '') delete next[key];
  store.write('app-settings', next);
  return globalSettings();
}

function saveChannel(channelId, patch) {
  const bersihkan = sanitize(patch, CHANNEL_KEYS);
  const all = readChannelsRaw();
  const next = { ...(all[channelId] || {}), ...bersihkan };
  for (const [key, value] of Object.entries(next)) if (value === '') delete next[key];
  all[channelId] = next;
  store.write('channel-settings', all);
  return forChannel(channelId);
}

module.exports = {
  globalSettings,
  forChannel,
  channelHours,
  saveGlobal,
  saveChannel,
  envDefaults,
  readGlobalRaw,
  readChannelsRaw,
  GLOBAL_KEYS,
  CHANNEL_KEYS,
  PLATFORM_POST_TYPES,
  YOUTUBE_PRIVACY,
  SettingError
};
