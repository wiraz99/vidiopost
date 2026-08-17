/**
 * Menyusun isi post yang dikirim ke Buffer: teks + metadata khusus platform.
 *
 * Buffer punya field tersendiri per platform lewat `metadata` (PostInputMetaData).
 * Sebagian WAJIB, dan post ditolak kalau tidak diisi:
 *   Instagram : type (post/story/reel) + shouldShareToFeed
 *   YouTube   : title + categoryId
 *   Pinterest : boardServiceId (+ title, url)
 * Lihat https://developers.buffer.com/types/PostInputMetaData.html
 *
 * Karena judul & link punya field sendiri di platform tersebut, keduanya
 * TIDAK lagi ditempel ke dalam teks caption seperti sebelumnya.
 */

// Platform yang memang lazim pakai hashtag. Pinterest & YouTube sengaja tidak.
const HASHTAG_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'threads'];

// Judulnya dikirim sebagai field tersendiri, bukan ditempel ke teks.
const METADATA_TITLE_PLATFORMS = ['youtube', 'pinterest'];

// Link-nya dikirim sebagai field tersendiri.
const METADATA_LINK_PLATFORMS = ['pinterest'];

// Link ditempel ke teks karena di sini tidak ada field khusus,
// tapi tautannya tetap berguna dan bisa diklik.
const TEXT_LINK_PLATFORMS = ['youtube', 'facebook'];

const LIMITS = {
  instagram: 2200,
  tiktok: 2200,
  threads: 500,
  pinterest: 500,
  youtube: 5000,
  facebook: 63206
};

// Bisa diubah lewat environment variable tanpa menyentuh kode.
const INSTAGRAM_TYPE = process.env.INSTAGRAM_POST_TYPE || 'reel';
const INSTAGRAM_SHARE_TO_FEED = process.env.INSTAGRAM_SHARE_TO_FEED !== 'false';
// 26 = Howto & Style, paling pas untuk konten makanan/resep.
const YOUTUBE_CATEGORY_ID = process.env.YOUTUBE_CATEGORY_ID || '26';
const YOUTUBE_PRIVACY = process.env.YOUTUBE_PRIVACY || 'public';
const PINTEREST_BOARD_ID = process.env.PINTEREST_BOARD_ID || '';

/** Teks post — judul & link hanya ikut kalau platformnya tidak punya field sendiri. */
function composePostText({ platform, title = '', caption = '', hashtags = [], link = '' }) {
  const parts = [];

  if (!METADATA_TITLE_PLATFORMS.includes(platform) && title.trim()) parts.push(title.trim());
  if (caption.trim()) parts.push(caption.trim());

  if (HASHTAG_PLATFORMS.includes(platform) && hashtags.length) {
    const existing = parts.join(' ').toLowerCase();
    const missing = hashtags.filter((t) => !existing.includes(t.toLowerCase()));
    if (missing.length) parts.push(missing.join(' '));
  }

  if (TEXT_LINK_PLATFORMS.includes(platform) && link.trim()) parts.push(link.trim());

  return parts.join('\n\n');
}

/**
 * Metadata khusus platform. Mengembalikan null kalau platformnya tidak perlu.
 * Field wajib yang belum bisa diisi dilaporkan lewat `missing`, supaya bisa
 * dicegah SEBELUM request dikirim — bukan setelah ditolak Buffer.
 */
function buildMetadata({ platform, title = '', link = '', boardId = '' }) {
  const missing = [];

  if (platform === 'instagram') {
    return {
      metadata: { instagram: { type: INSTAGRAM_TYPE, shouldShareToFeed: INSTAGRAM_SHARE_TO_FEED } },
      missing
    };
  }

  if (platform === 'youtube') {
    if (!title.trim()) missing.push('judul video (wajib untuk YouTube)');
    return {
      metadata: {
        youtube: {
          title: title.trim().slice(0, 100), // batas judul YouTube
          categoryId: String(YOUTUBE_CATEGORY_ID),
          privacy: YOUTUBE_PRIVACY
        }
      },
      missing
    };
  }

  if (platform === 'pinterest') {
    const board = boardId || PINTEREST_BOARD_ID;
    if (!board) missing.push('board Pinterest (isi PINTEREST_BOARD_ID)');
    const pinterest = { boardServiceId: board };
    if (title.trim()) pinterest.title = title.trim().slice(0, 100);
    if (link.trim()) pinterest.url = link.trim();
    return { metadata: { pinterest }, missing };
  }

  // tiktok, facebook, threads tidak punya field wajib
  return { metadata: null, missing };
}

/** Bangun sekaligus teks + metadata untuk satu post. */
function buildPost({ platform, title = '', caption = '', hashtags = [], link = '', boardId = '' }) {
  const text = composePostText({ platform, title, caption, hashtags, link });
  const { metadata, missing } = buildMetadata({ platform, title, link, boardId });
  return { text, metadata, missing, warning: lengthWarning(platform, text) };
}

/** Peringatan panjang teks (tidak memblokir — user yang memutuskan). */
function lengthWarning(platform, text) {
  const limit = LIMITS[platform];
  if (!limit || text.length <= limit) return null;
  return `Teks ${text.length} karakter, melebihi batas ${platform} (${limit}).`;
}

module.exports = {
  composePostText,
  buildMetadata,
  buildPost,
  lengthWarning,
  HASHTAG_PLATFORMS,
  METADATA_TITLE_PLATFORMS,
  METADATA_LINK_PLATFORMS,
  TEXT_LINK_PLATFORMS,
  LIMITS
};
