// ============================================================
//  SEMUA ANGKA & TEKS YANG SERING DIUBAH ADA DI FILE INI SAJA
// ============================================================

// Batas antrian Buffer per channel. Dipakai untuk indikator "3/10 terpakai".
// Kalau Buffer mengubah kebijakan, cukup ganti angka ini (dan QUEUE_LIMIT di server.js).
export const QUEUE_LIMIT = 10;

// Batas jumlah karakter caption per platform.
// Angka ini SENGAJA taksiran / longgar — silakan sesuaikan kapan pun.
// `soft` = mulai diberi warna kuning (peringatan), `hard` = dianggap kelewatan (merah).
export const PLATFORM_LIMITS = {
  instagram: { soft: 2000, hard: 2200 },
  tiktok:    { soft: 2000, hard: 2200 },
  threads:   { soft: 450,  hard: 500 },
  pinterest: { soft: 450,  hard: 500 },
  youtube:   { soft: 4500, hard: 5000 },
  facebook:  { soft: 5000, hard: 63206 }, // Facebook praktis tidak ketat
  default:   { soft: 2000, hard: 2200 }
};

// Field tambahan selain caption, per platform.
export const PLATFORM_FIELDS = {
  youtube: {
    title: { label: 'Judul video', placeholder: 'Judul YouTube...', max: 100 }
  },
  pinterest: {
    title: { label: 'Judul pin', placeholder: 'Judul Pinterest...', max: 100 },
    link:  { label: 'Link tujuan', placeholder: 'https://... (halaman produk / WA)', max: 2000 }
  }
};

// ---- BANK HASHTAG BRAND -------------------------------------
// Isi/ubah daftar di bawah ini sesukamu. Yang `default: true` otomatis
// dicentang; user tetap bisa matikan per video lewat toggle di kartu.
export const HASHTAG_BANK = [
  { tag: '#SalePisangGranola', default: true },
  { tag: '#Arachynana',        default: true },
  { tag: '#CamilanSehat',      default: true }
];

// Hashtag ekstra khusus platform tertentu (opsional, boleh dikosongkan).
export const PLATFORM_HASHTAGS = {
  tiktok: ['#fyp'],
  instagram: ['#reels']
};

// Platform mana yang benar-benar memakai hashtag. Pinterest & YouTube
// lebih rapi tanpa tumpukan hashtag, jadi default-nya dimatikan.
export const HASHTAG_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'threads'];

// Label & warna aksen tiap platform (dipakai di badge, preview, checkbox).
export const PLATFORM_META = {
  instagram: { name: 'Instagram', color: '#d6266f', icon: 'IG' },
  tiktok:    { name: 'TikTok',    color: '#111827', icon: 'TT' },
  youtube:   { name: 'YouTube',   color: '#dc2626', icon: 'YT' },
  facebook:  { name: 'Facebook',  color: '#1d4ed8', icon: 'FB' },
  threads:   { name: 'Threads',   color: '#0f172a', icon: 'TH' },
  pinterest: { name: 'Pinterest', color: '#be123c', icon: 'PN' },
  default:   { name: 'Lainnya',   color: '#475569', icon: '??' }
};

// Nama brand — dipakai sebagai nama akun di preview.
export const BRAND_NAME = 'Arachynana';

export const limitsFor = (platform) => PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.default;
export const metaFor = (platform) => PLATFORM_META[platform] || PLATFORM_META.default;
export const fieldsFor = (platform) => PLATFORM_FIELDS[platform] || {};
