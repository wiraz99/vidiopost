/**
 * Menyusun teks akhir yang dikirim ke Buffer.
 *
 * CATATAN: /api/publish Buffer hanya menerima SATU string per post, jadi judul
 * (YouTube) dan judul + link (Pinterest) digabung ke dalam teks. Kalau probe Fase 0
 * menemukan field khusus di CreatePostInput, ganti bagian ini supaya dikirim terpisah.
 */

// Platform yang memang lazim pakai hashtag. Pinterest & YouTube sengaja tidak.
const HASHTAG_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'threads'];

// Platform yang menampilkan judul terpisah dari isi.
const TITLED_PLATFORMS = ['youtube', 'pinterest'];

const LIMITS = {
  instagram: 2200,
  tiktok: 2200,
  threads: 500,
  pinterest: 500,
  youtube: 5000,
  facebook: 63206
};

/** Gabungkan judul, caption, hashtag, dan link jadi satu teks post. */
function composePostText({ platform, title = '', caption = '', hashtags = [], link = '' }) {
  const parts = [];

  if (TITLED_PLATFORMS.includes(platform) && title.trim()) parts.push(title.trim());
  if (caption.trim()) parts.push(caption.trim());

  if (HASHTAG_PLATFORMS.includes(platform) && hashtags.length) {
    const lower = parts.join(' ').toLowerCase();
    const missing = hashtags.filter((t) => !lower.includes(t.toLowerCase()));
    if (missing.length) parts.push(missing.join(' '));
  }

  if (platform === 'pinterest' && link.trim()) parts.push(link.trim());

  return parts.join('\n\n');
}

/** Peringatan panjang teks (tidak memblokir — user yang memutuskan). */
function lengthWarning(platform, text) {
  const limit = LIMITS[platform];
  if (!limit || text.length <= limit) return null;
  return `Teks ${text.length} karakter, melebihi batas ${platform} (${limit}).`;
}

module.exports = { composePostText, lengthWarning, HASHTAG_PLATFORMS, TITLED_PLATFORMS, LIMITS };
