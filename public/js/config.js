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

export const PLATFORM_META = {
  instagram: { name: 'Instagram', color: '#d6266f', icon: 'IG' },
  tiktok:    { name: 'TikTok',    color: '#111827', icon: 'TT' },
  youtube:   { name: 'YouTube',   color: '#dc2626', icon: 'YT' },
  facebook:  { name: 'Facebook',  color: '#1d4ed8', icon: 'FB' },
  threads:   { name: 'Threads',   color: '#0f172a', icon: 'TH' },
  pinterest: { name: 'Pinterest', color: '#be123c', icon: 'PN' },
  default:   { name: 'Lainnya',   color: '#475569', icon: '??' }
};

export const BRAND_NAME = 'Arachynana';

// Batas antrian Buffer per channel (samakan dengan QUEUE_LIMIT di lib/rotation.js).
export const QUEUE_LIMIT = 10;

export const NAV = [
  { path: '/stok',    label: 'Stok Video', icon: '🎬' },
  { path: '/jadwal',  label: 'Jadwal',     icon: '🗓' },
  { path: '/hashtag', label: 'Hashtag',    icon: '#' },
  { path: '/insight', label: 'Insight',    icon: '📊' },
  { path: '/riwayat', label: 'Riwayat',    icon: '🕘' }
];

export const limitsFor = (platform) => PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.default;
export const metaFor = (platform) => PLATFORM_META[platform] || PLATFORM_META.default;
