// ============================================================
//  Setelan tampilan. Angka & aturan yang dipakai server ada di
//  lib/compose.js dan lib/rotation.js — ubah di sana juga kalau perlu.
// ============================================================

// Batas karakter per platform: `soft` = hitungan jadi kuning, `hard` = merah.
export const PLATFORM_LIMITS = {
  instagram: { soft: 2000, hard: 2200 },
  tiktok:    { soft: 2000, hard: 2200 },
  threads:   { soft: 450,  hard: 500 },
  pinterest: { soft: 450,  hard: 500 },
  youtube:   { soft: 4500, hard: 5000 },
  facebook:  { soft: 5000, hard: 63206 },
  default:   { soft: 2000, hard: 2200 }
};

// `color` = warna brand penuh (dipakai avatar di preview).
// `soft` + `ink` = versi lembut untuk monogram, supaya tidak berisik
// waktu enam channel berjejer sekaligus.
export const PLATFORM_META = {
  instagram: { name: 'Instagram', icon: 'IG', color: '#d6266f', soft: '#fdf2f8', ink: '#be185d' },
  tiktok:    { name: 'TikTok',    icon: 'TT', color: '#18181b', soft: '#f4f4f5', ink: '#27272a' },
  youtube:   { name: 'YouTube',   icon: 'YT', color: '#dc2626', soft: '#fef2f2', ink: '#b91c1c' },
  facebook:  { name: 'Facebook',  icon: 'FB', color: '#1d4ed8', soft: '#eff6ff', ink: '#1d4ed8' },
  threads:   { name: 'Threads',   icon: 'TH', color: '#0f172a', soft: '#f4f4f5', ink: '#0f172a' },
  pinterest: { name: 'Pinterest', icon: 'PN', color: '#be123c', soft: '#fff1f2', ink: '#be123c' },
  default:   { name: 'Lainnya',   icon: '??', color: '#71717a', soft: '#f4f4f5', ink: '#52525b' }
};

export const BRAND_NAME = 'Arachynana';

// Batas antrian Buffer per channel (samakan dengan QUEUE_LIMIT di lib/rotation.js).
export const QUEUE_LIMIT = 10;

export const NAV = [
  { path: '/stok',    label: 'Stok Video', icon: 'video' },
  { path: '/jadwal',  label: 'Jadwal',     icon: 'calendar' },
  { path: '/hashtag', label: 'Hashtag',    icon: 'hash' },
  { path: '/insight', label: 'Insight',    icon: 'chart' },
  { path: '/riwayat', label: 'Riwayat',    icon: 'clock' }
];

export const limitsFor = (platform) => PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.default;
export const metaFor = (platform) => PLATFORM_META[platform] || PLATFORM_META.default;
