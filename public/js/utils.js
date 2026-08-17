import { metaFor } from './config.js';
import { icon, iconSvg } from './icons.js';

export { icon, iconSvg };

/** Bikin elemen: el('div', 'kelas', 'teks') */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** el() + isi HTML mentah. Hanya untuk markup yang KITA yang bikin. */
export function html(tag, className, markup) {
  const node = el(tag, className);
  node.innerHTML = markup;
  return node;
}

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Monogram platform: kotak membulat bernuansa lembut, bukan blok warna penuh. */
export function platformDot(platform) {
  const meta = metaFor(platform);
  const dot = el('span', 'pdot', meta.icon);
  dot.style.background = meta.soft;
  dot.style.color = meta.ink;
  dot.style.borderColor = meta.ink + '26'; // ~15% opacity
  dot.title = meta.name;
  return dot;
}

/**
 * Thumbnail video.
 *
 * Elemen <video> dengan preload="metadata" cuma mengambil durasi & dimensi —
 * tidak ada satu frame pun yang di-decode, jadi kotaknya tampil kosong/hitam.
 * Supaya muncul gambar, videonya harus dipaksa melompat ke detik tertentu.
 *
 * Loncatnya ke 10% durasi (maksimal 1 detik), bukan ke detik 0, karena banyak
 * video dibuka dengan fade-in dari hitam — frame pertama justru gelap.
 *
 * Pemuatan ditunda sampai elemennya kelihatan di layar; menarik metadata
 * sepuluh video sekaligus terlalu berat untuk koneksi HP.
 */
const thumbObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        obs.unobserve(entry.target);
        loadThumb(entry.target);
      }
    }, { rootMargin: '200px' })
  : null;

function loadThumb(video) {
  if (video.dataset.loaded) return;
  video.dataset.loaded = '1';

  video.addEventListener('loadedmetadata', () => {
    const target = Math.min(1, (video.duration || 2) * 0.1);
    if (Number.isFinite(target) && target > 0) {
      try {
        video.currentTime = target;
      } catch {
        // sebagian browser menolak seek sebelum siap — biarkan, fragmen #t sudah jadi cadangan
      }
    }
  }, { once: true });

  video.addEventListener('error', () => {
    // Video tidak bisa diambil (URL salah / file hilang) — tampilkan penanda,
    // jangan biarkan kotak hitam tanpa keterangan.
    const fallback = el('div', video.className + ' thumb-fallback');
    fallback.title = 'Video tidak bisa dimuat — cek PUBLIC_BASE_URL';
    fallback.innerHTML = iconSvg('alert', 16);
    video.replaceWith(fallback);
  }, { once: true });

  // Fragmen media #t= jadi cadangan untuk browser yang mengabaikan seek manual.
  video.src = `${video.dataset.src}#t=0.1`;
}

export function videoThumb(url, className = 'vthumb') {
  const video = el('video', className);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.dataset.src = url;

  if (thumbObserver) thumbObserver.observe(video);
  else loadThumb(video);

  return video;
}

/** Tombol dengan ikon di kiri teks. */
export function button(className, iconName, label) {
  const btn = el('button', className);
  btn.type = 'button';
  if (iconName) btn.append(icon(iconName, className.includes('btn-sm') ? 14 : 16));
  if (label) btn.append(el('span', null, label));
  return btn;
}

/** Tombol yang isinya cuma ikon. */
export function iconButton(iconName, title, className = 'icon-btn') {
  const btn = el('button', className);
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.append(icon(iconName, 16));
  return btn;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso, withTime = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

/** '2026-08-20' → 'Kam, 20 Agu' */
export function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatNumber = (n) => Number(n || 0).toLocaleString('id-ID');

/** Toast pojok layar. Dipakai untuk semua notifikasi sukses/gagal. */
export function toast(message, kind = '') {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const node = el('div', `toast ${kind}`);
  if (kind) node.append(icon(kind === 'ok' ? 'check' : 'alert', 15));
  node.append(el('span', null, message));
  wrap.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, kind === 'bad' ? 6000 : 3200);
}

/** Tandai tombol sedang bekerja, kembalikan fungsi untuk memulihkannya. */
export function busy(button, label = 'Memproses…') {
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.innerHTML = `<span class="spin"></span> ${escapeHtml(label)}`;
  return () => {
    button.innerHTML = original;
    button.disabled = wasDisabled;
  };
}

/** Tunggu sebentar — dipakai untuk memberi jeda antar request ke Buffer. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jalankan fn setelah user berhenti mengetik. */
export function debounce(fn, wait = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Pasang penghitung karakter pada textarea/input sesuai batas platform. */
export function attachCounter(input, counter, limits) {
  const sync = () => {
    const n = input.value.length;
    counter.textContent = `${n} / ${limits.hard} karakter`;
    counter.className = `count${n > limits.hard ? ' count-bad' : n > limits.soft ? ' count-warn' : ''}`;
  };
  input.addEventListener('input', sync);
  sync();
  return sync;
}
