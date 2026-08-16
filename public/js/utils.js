import { HASHTAG_BANK, PLATFORM_HASHTAGS, HASHTAG_PLATFORMS } from './config.js';

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 10);

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Daftar hashtag aktif untuk sebuah platform, berdasarkan bank + tambahan platform.
export function hashtagsFor(platform, enabledTags) {
  if (!HASHTAG_PLATFORMS.includes(platform)) return [];
  const base = HASHTAG_BANK.filter((h) => enabledTags.has(h.tag)).map((h) => h.tag);
  return [...base, ...(PLATFORM_HASHTAGS[platform] || [])];
}

// Sisipkan hashtag ke akhir caption, tanpa menduplikasi yang sudah ada di teks.
export function appendHashtags(text, tags) {
  if (!tags.length) return text;
  const lower = text.toLowerCase();
  const missing = tags.filter((t) => !lower.includes(t.toLowerCase()));
  if (!missing.length) return text;
  return `${text.trimEnd()}\n\n${missing.join(' ')}`;
}

// Buang blok hashtag yang kita sisipkan (dipakai saat toggle dimatikan).
export function stripHashtags(text, tags) {
  let out = text;
  for (const tag of tags) {
    out = out.replace(new RegExp(`\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trimEnd();
}

// /api/publish hanya menerima satu string `text` per channel, jadi field tambahan
// (judul YouTube, judul + link Pinterest) digabung ke dalam teks tersebut.
export function composeText(platform, { caption = '', title = '', link = '' }) {
  const parts = [];
  if (platform === 'youtube' || platform === 'pinterest') {
    if (title.trim()) parts.push(title.trim());
  }
  if (caption.trim()) parts.push(caption.trim());
  if (platform === 'pinterest' && link.trim()) parts.push(link.trim());
  return parts.join('\n\n');
}
